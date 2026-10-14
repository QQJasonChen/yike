// 把一段時間的手帳 Markdown 直送到「用戶自己的 Notion」。
// 瀏覽器不能直打 api.notion.com（CORS），這支 function 只做無狀態轉發：
// 用戶的 integration token 隨每個請求進來、轉發給 Notion、不寫 log 不落地。
// 部署：supabase functions deploy notion-push --no-verify-jwt

import { mdToNotionBlocks, NotionConversionLimitError } from './blocks.ts'
import { BodyReadError, readBoundedJson } from '../_shared/boundedBody.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

const NOTION = 'https://api.notion.com/v1'
const CHUNK = 100 // Notion 單請求 children 上限
const MAX_BODY_BYTES = 256 * 1024
const MAX_BLOCKS = 1000 // 最多 10 次寫入，不能讓單次匿名匯出產生無界外部工作
const MAX_OUTBOUND_BYTES = 1024 * 1024
const MAX_UPSTREAM_BODY_BYTES = 512 * 1024
const BODY_TIMEOUT_MS = 5000
const UPSTREAM_TIMEOUT_MS = 8000
const TOTAL_TIMEOUT_MS = 30000
const SMALLER_RANGE = '匯出內容太多，請縮短日期範圍再送到 Notion；完整內容仍可下載 Markdown。'

class RequestFailure extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

/** 逾時涵蓋 headers 與 JSON body；總 budget 到期後不再開始下一批。 */
const upstreamJson = async (url: string, init: RequestInit, budget: AbortSignal) => {
  if (budget.aborted) throw new RequestFailure(504, 'Notion 匯出逾時，請縮短日期範圍後再試。')
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS)
  const signal = AbortSignal.any([budget, ac.signal])
  try {
    const res = await fetch(url, { ...init, signal, redirect: 'error' })
    let body: unknown = {}
    try {
      // Use the same bounded byte reader for provider responses. The adapter
      // supplies only fields read by the helper; no new network request occurs.
      body = await readBoundedJson({
        headers: res.headers, body: res.body, signal,
      } as Request, MAX_UPSTREAM_BODY_BYTES, UPSTREAM_TIMEOUT_MS, signal)
    } catch (error) {
      if (signal.aborted) throw new RequestFailure(504, 'Notion 匯出逾時，請縮短日期範圍後再試。')
      if (error instanceof BodyReadError && error.status === 413)
        throw new RequestFailure(502, 'Notion 回覆超過處理上限；請先檢查目標頁面後再試。')
      if (res.ok)
        throw new RequestFailure(502, 'Notion 回覆格式不完整，無法確認這次寫入；請先檢查目標頁面。')
    }
    return { res, body }
  } catch (error) {
    if (error instanceof RequestFailure) throw error
    throw new RequestFailure(signal.aborted ? 504 : 502,
      signal.aborted ? 'Notion 匯出逾時，請縮短日期範圍後再試。' : '暫時連不上 Notion，請稍後再試。')
  } finally {
    clearTimeout(timer)
  }
}

const notionHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
})

/** 把 Notion 錯誤翻成用戶看得懂的話 */
const friendly = (status: number, body: unknown): string => {
  if (status === 401) return 'Token 無效——請回 notion.so/my-integrations 重新複製 Internal Integration Secret'
  if (status === 404)
    return '找不到目標頁面——請確認頁面右上角 ⋯ → Connections 已加入你的 integration，且連結貼的是頁面（不是 database）'
  const message = body !== null && typeof body === 'object' ? (body as { message?: unknown }).message : undefined
  return typeof message === 'string' ? message.slice(0, 500) : `Notion 回應 ${status}`
}

/** IP 節流（跟 activate 同一套 rate_limit_bump RPC）。
 *  這支是 --no-verify-jwt 的無狀態轉發——純本機使用者（沒有帳號）也要能送 Notion，
 *  所以不能要求登入。但沒有任何閘門的話它就是一個開放中繼：任何人拿任意 Notion token
 *  往這裡灌，燒的是這個專案免費方案的呼叫額度，而且流量看起來全是從 yike 出去的。
 *  一小時 60 次對真人綽綽有餘（一次匯出＝一次呼叫）。
 *  fail-closed：計數器壞掉就擋，不要因為節流故障而變成完全不設防。 */
const rateLimited = async (req: Request, budget: AbortSignal): Promise<boolean | null> => {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const srk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!url || !srk) return null
  const forwarded = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown'
  // This bounds counter-key work, without claiming caller-supplied IP headers
  // prove identity or provide a project-wide cost ceiling.
  const ip = forwarded.length > 200 || new TextEncoder().encode(forwarded).byteLength > 200
    ? 'oversized-ip-header' : forwarded.split(',')[0].trim() || 'unknown'
  try {
    const { res: r, body } = await upstreamJson(`${url}/rest/v1/rpc/rate_limit_bump`, {
      method: 'POST',
      headers: { apikey: srk, Authorization: `Bearer ${srk}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ k: `notion:ip:${ip}`, cap: 60, window_seconds: 3600 }),
    }, budget)
    if (!r.ok) {
      console.error('rate_limit_bump 失敗', r.status)
      return null
    }
    return typeof body === 'boolean' ? !body : null
  } catch {
    console.error('rate_limit_bump 無法完成')
    return null
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })
  const budget = new AbortController()
  const timer = setTimeout(() => budget.abort(), TOTAL_TIMEOUT_MS)
  const signal = AbortSignal.any([budget.signal, req.signal])
  let createdUrl: string | undefined
  let writeStarted = false
  try {
    const limited = await rateLimited(req, signal)
    if (limited === null)
      return json(503, { error: '匯出服務暫時無法使用，請稍後再試。' })
    if (limited)
      return json(429, { error: '這一小時送太多次了，請稍後再試（每小時最多 60 次）' })
    const parsed = await readBoundedJson(req, MAX_BODY_BYTES, BODY_TIMEOUT_MS, signal)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
      return json(400, { error: '格式錯誤' })
    const body = parsed as Record<string, unknown>
    if (typeof body.token !== 'string' || typeof body.parentPageId !== 'string' ||
        (body.title !== undefined && typeof body.title !== 'string') ||
        (body.markdown !== undefined && typeof body.markdown !== 'string') ||
        (body.dryRun !== undefined && typeof body.dryRun !== 'boolean'))
      return json(400, { error: '格式錯誤' })
    const token = body.token.trim()
    const parentPageId = body.parentPageId.trim().replace(/-/g, '').toLowerCase()
    const title = (typeof body.title === 'string' ? body.title.trim() : '') || '一刻手帳匯出'
    const markdown = typeof body.markdown === 'string' ? body.markdown : ''
    if (!token || !/^[0-9a-f]{32}$/.test(parentPageId))
      return json(400, { error: '請先完成 Notion 設定（Token 與有效的目標頁面 ID）' })
    if (token.length > 4096 || title.length > 2000)
      return json(413, { error: SMALLER_RANGE })
    // 測試連線不寫入，也受相同網路 budget 保護。
    if (body.dryRun === true) {
      const { res, body: page } = await upstreamJson(`${NOTION}/pages/${parentPageId}`, { headers: notionHeaders(token) }, signal)
      if (!res.ok) return json(res.status === 401 ? 401 : 403, { error: friendly(res.status, page) })
      if (page === null || typeof page !== 'object' ||
          typeof (page as { id?: unknown }).id !== 'string' ||
          (page as { id: string }).id.replace(/-/g, '').toLowerCase() !== parentPageId)
        throw new RequestFailure(502, 'Notion 回覆的頁面資訊不完整，無法確認連線；請檢查目標頁面。')
      return json(200, { ok: true })
    }
    if (!markdown.trim()) return json(400, { error: '這段日期內沒有內容可匯出' })
    const blocks = mdToNotionBlocks(markdown, { maxBlocks: MAX_BLOCKS, maxRichTextParts: 100 })
    if (blocks.length > MAX_BLOCKS || blocks.some(block => {
      const rich = (block[block.type as string] as { rich_text?: unknown[] } | undefined)?.rich_text
      return rich && rich.length > 100
    })) return json(413, { error: SMALLER_RANGE })
    // 在第一筆外部寫入前檢查所有批次大小，避免做到一半才知道超限。
    const chunks: string[] = []
    const encoder = new TextEncoder()
    let outboundBytes = 0
    for (let i = 0; i < blocks.length; i += CHUNK) {
      const data = JSON.stringify(i === 0 ? {
        parent: { page_id: parentPageId },
        properties: { title: { title: [{ text: { content: title } }] } },
        children: blocks.slice(i, i + CHUNK),
      } : { children: blocks.slice(i, i + CHUNK) })
      const bytes = encoder.encode(data).byteLength
      outboundBytes += bytes
      if (bytes > 400 * 1024 || outboundBytes > MAX_OUTBOUND_BYTES)
        return json(413, { error: SMALLER_RANGE })
      chunks.push(data)
    }
    writeStarted = true
    const { res: createRes, body: created } = await upstreamJson(`${NOTION}/pages`, {
      method: 'POST', headers: notionHeaders(token), body: chunks[0],
    }, signal)
    if (!createRes.ok) return json(createRes.status === 401 ? 401 : 400, {
      error: createRes.status >= 500
        ? `Notion 可能已建立頁面但無法確認：${friendly(createRes.status, created)}。請先到 Notion 檢查，再決定是否重送，避免重複頁面。`
        : friendly(createRes.status, created),
    })
    const pageId = created !== null && typeof created === 'object' &&
        typeof (created as { id?: unknown }).id === 'string'
      ? (created as { id: string }).id.replace(/-/g, '') : ''
    if (!/^[0-9a-f]{32}$/i.test(pageId))
      throw new RequestFailure(502, 'Notion 回覆的頁面資訊不完整；請先檢查 Notion 是否已建立頁面，避免重複匯出。')
    createdUrl = `https://www.notion.so/${pageId}`
    for (let i = 1; i < chunks.length; i++) {
      const { res, body: appended } = await upstreamJson(`${NOTION}/blocks/${pageId}/children`, {
        method: 'PATCH', headers: notionHeaders(token), body: chunks[i],
      }, signal)
      if (!res.ok) return json(400, {
        error: `頁面已建立但內容只寫入一部分：${friendly(res.status, appended)}`,
        url: createdUrl,
      })
      const results = appended !== null && typeof appended === 'object'
        ? (appended as { results?: unknown }).results : undefined
      if (!Array.isArray(results) || results.length !== Math.min(CHUNK, blocks.length - i * CHUNK))
        throw new RequestFailure(502, 'Notion 未回覆完整批次的寫入結果；請先檢查頁面，避免重複匯出。')
    }
    return json(200, { ok: true, url: createdUrl })
  } catch (error) {
    const failure = error instanceof RequestFailure ? error
      : error instanceof NotionConversionLimitError ? new RequestFailure(413, SMALLER_RANGE)
      : error instanceof BodyReadError ? new RequestFailure(error.status,
        error.status === 413 ? SMALLER_RANGE : error.status === 408
          ? '接收匯出內容逾時，請縮短日期範圍或確認網路後再試。' : '格式錯誤')
      : new RequestFailure(500, '匯出暫時無法完成，請稍後再試。')
    return json(failure.status, {
      error: createdUrl ? `頁面已建立但內容只寫入一部分：${failure.message}`
        : writeStarted ? `Notion 未能確認是否寫入：${failure.message} 請先到 Notion 檢查，再決定是否重送，避免重複頁面。`
        : failure.message,
      ...(createdUrl ? { url: createdUrl } : {}),
    })
  } finally {
    clearTimeout(timer)
  }
})
