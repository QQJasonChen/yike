// 把一段時間的手帳 Markdown 直送到「用戶自己的 Notion」。
// 瀏覽器不能直打 api.notion.com（CORS），這支 function 只做無狀態轉發：
// 用戶的 integration token 隨每個請求進來、轉發給 Notion、不寫 log 不落地。
// 部署：supabase functions deploy notion-push --no-verify-jwt

import { mdToNotionBlocks } from './blocks.ts'

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

const notionHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
})

/** 把 Notion 錯誤翻成用戶看得懂的話 */
const friendly = (status: number, body: { message?: string }): string => {
  if (status === 401) return 'Token 無效——請回 notion.so/my-integrations 重新複製 Internal Integration Secret'
  if (status === 404)
    return '找不到目標頁面——請確認頁面右上角 ⋯ → Connections 已加入你的 integration，且連結貼的是頁面（不是 database）'
  return body.message ?? `Notion 回應 ${status}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })

  let token = '', parentPageId = '', title = '', markdown = '', dryRun = false
  try {
    const body = await req.json()
    token = String(body.token ?? '').trim()
    parentPageId = String(body.parentPageId ?? '').trim()
    title = String(body.title ?? '').trim() || '一刻手帳匯出'
    markdown = String(body.markdown ?? '')
    dryRun = Boolean(body.dryRun)
  } catch {
    return json(400, { error: '格式錯誤' })
  }
  if (!token || !parentPageId) return json(400, { error: '請先完成 Notion 設定（Token 與目標頁面）' })

  // 測試連線：只讀取頁面確認權限，不寫入
  if (dryRun) {
    const res = await fetch(`${NOTION}/pages/${parentPageId}`, { headers: notionHeaders(token) })
    const page = await res.json().catch(() => ({}))
    if (!res.ok) return json(res.status === 401 ? 401 : 403, { error: friendly(res.status, page) })
    return json(200, { ok: true })
  }

  if (!markdown.trim()) return json(400, { error: '這段日期內沒有內容可匯出' })
  const blocks = mdToNotionBlocks(markdown)

  // 1) 建子頁面（帶第一批 blocks）
  const createRes = await fetch(`${NOTION}/pages`, {
    method: 'POST',
    headers: notionHeaders(token),
    body: JSON.stringify({
      parent: { page_id: parentPageId },
      properties: { title: { title: [{ text: { content: title } }] } },
      children: blocks.slice(0, CHUNK),
    }),
  })
  const created = await createRes.json().catch(() => ({}))
  if (!createRes.ok) return json(createRes.status === 401 ? 401 : 400, { error: friendly(createRes.status, created) })

  // 2) 其餘 blocks 分批補上
  for (let i = CHUNK; i < blocks.length; i += CHUNK) {
    const appendRes = await fetch(`${NOTION}/blocks/${created.id}/children`, {
      method: 'PATCH',
      headers: notionHeaders(token),
      body: JSON.stringify({ children: blocks.slice(i, i + CHUNK) }),
    })
    if (!appendRes.ok) {
      const e = await appendRes.json().catch(() => ({}))
      return json(400, {
        error: `頁面已建立但內容只寫入一部分：${friendly(appendRes.status, e)}`,
        url: created.url,
      })
    }
  }

  return json(200, { ok: true, url: created.url })
})
