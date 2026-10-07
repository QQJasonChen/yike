// Garmin Health API 推送接收端。Garmin 每次手錶同步就 POST 過來：
//   Push 模式：{ dailies: [{ userId, calendarDate, steps, … }], sleeps: [...], hrv: [...], … }
//   Ping 模式：{ dailies: [{ userId, callbackURL }] } → 我們拿使用者 token 去 callbackURL 取資料
//   解除註冊：{ deregistrations: [{ userId }] }（使用者在 Garmin Connect 移除了授權）
// 原始摘要按類型合併存進 health_daily；解析成指標在前端做（src/health.ts，只有一份解析器）。
//
// 部署：supabase functions deploy garmin-webhook --no-verify-jwt
// 在 Garmin 開發者後台（Endpoint Configuration）把各摘要類型的網址設成：
//   https://<專案>.supabase.co/functions/v1/garmin-webhook?k=<GARMIN_WEBHOOK_KEY>
// GARMIN_WEBHOOK_KEY（可選但強烈建議）：supabase secrets set GARMIN_WEBHOOK_KEY=<隨機字串>
//   Garmin 推送不帶簽章，用網址裡的密鑰擋掉亂打的請求。

import { db, validToken, type Link } from '../_shared/garmin.ts'

const KEY = Deno.env.get('GARMIN_WEBHOOK_KEY') ?? ''

// 只收跟每日身體狀況有關的摘要類型（活動 GPS、epoch 細節等不存）
const TYPES = new Set([
  'dailies',
  'sleeps',
  'hrv',
  'stressDetails',
  'userMetrics',
  'pulseox',
  'respiration',
  'bodyComps',
  'healthSnapshot',
])

type Item = Record<string, unknown>

const pad = (n: number) => String(n).padStart(2, '0')

/** 摘要屬於哪一天：優先 calendarDate；沒有就用開始／量測時間＋時區偏移換算當地日期 */
const dayOf = (it: Item): string | null => {
  if (typeof it.calendarDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(it.calendarDate)) return it.calendarDate
  const t = Number(it.startTimeInSeconds ?? it.measurementTimeInSeconds)
  if (!Number.isFinite(t)) return null
  const off = Number(it.startTimeOffsetInSeconds ?? it.measurementTimeOffsetInSeconds ?? 0) || 0
  const d = new Date((t + off) * 1000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

const linksFor = async (garminIds: string[]): Promise<Map<string, Link>> => {
  const map = new Map<string, Link>()
  if (!garminIds.length) return map
  const list = garminIds.map((id) => `"${id.replace(/"/g, '')}"`).join(',')
  const r = await db(`garmin_links?garmin_user_id=in.(${encodeURIComponent(list)})&select=*`)
  for (const l of (await r.json().catch(() => [])) as Link[]) map.set(l.garmin_user_id, l)
  return map
}

const save = async (uid: string, type: string, it: Item) => {
  const day = dayOf(it)
  if (!day) return
  // 不存 token 之類跟健康無關的欄位
  const { userAccessToken: _t, callbackURL: _c, ...clean } = it
  const patch = { [type]: { ...clean, calendarDate: day } }
  await db('rpc/health_daily_merge', {
    method: 'POST',
    body: JSON.stringify({ p_user: uid, p_day: day, p_patch: patch }),
  })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok')
  if (KEY && new URL(req.url).searchParams.get('k') !== KEY) return new Response('forbidden', { status: 403 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return new Response('bad json', { status: 400 })
  }

  // 1) 解除註冊：刪 token（健康資料保留，使用者可在 app 內一鍵刪）
  const dereg = Array.isArray(body.deregistrations) ? (body.deregistrations as Item[]) : []
  for (const d of dereg) {
    const gid = String(d.userId ?? '')
    if (gid) await db(`garmin_links?garmin_user_id=eq.${encodeURIComponent(gid)}`, { method: 'DELETE' })
  }

  // 2) 摘要
  const entries = Object.entries(body).filter(([k, v]) => TYPES.has(k) && Array.isArray(v)) as [string, Item[]][]
  const ids = [...new Set(entries.flatMap(([, items]) => items.map((i) => String(i.userId ?? ''))).filter(Boolean))]
  const links = await linksFor(ids)

  for (const [type, items] of entries) {
    for (const it of items) {
      const link = links.get(String(it.userId ?? ''))
      if (!link) continue // 不認識的 Garmin 使用者（已解除連結）：丟掉
      if (typeof it.callbackURL === 'string') {
        // Ping 模式：拿 token 去取真正的資料（只准打 Garmin 自己的網域）
        const cb = new URL(it.callbackURL)
        if (!/\.garmin\.com$/.test(cb.hostname)) continue
        try {
          const tok = await validToken(link)
          const r = await fetch(cb, { headers: { Authorization: `Bearer ${tok}` } })
          const rows = (await r.json().catch(() => [])) as Item[]
          for (const row of Array.isArray(rows) ? rows : []) await save(link.user_id, type, row)
        } catch {
          /* 單筆失敗不影響其他筆；Garmin 之後還會再推 */
        }
      } else {
        await save(link.user_id, type, it)
      }
    }
  }
  // Garmin 要求盡快回 200，否則會重送
  return new Response('ok')
})
