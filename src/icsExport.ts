// 時間軸 → iCalendar (.ics) 匯出：通用行事曆格式，Google Calendar 直接匯入、
// Notion Calendar 經 Google 同步看到。零 OAuth 零 API——資料屬於你，檔案帶著走。
// 時間用 floating local time（無時區後綴）：匯入方以使用者當地時區解讀，個人行程最單純。

import { loadDay } from './storage'

/** ICS 文字跳脫（逗號/分號/反斜線/換行） */
export const icsEscape = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** YYYY-MM-DD + 分鐘數 → ICS 本地時間 20260706T093000 */
export const icsDateTime = (dateKey: string, minutes: number): string => {
  const h = String(Math.floor(minutes / 60)).padStart(2, '0')
  const m = String(minutes % 60).padStart(2, '0')
  return `${dateKey.replace(/-/g, '')}T${h}${m}00`
}

export interface IcsEvent {
  dateKey: string
  start: number // 分鐘
  end: number
  text: string
  note?: string
  uidSeed: string // 穩定 UID 來源（block id）：重複匯入時同事件會更新而非重複
}

/** 事件陣列 → 完整 .ics 內容 */
export const buildIcs = (events: IcsEvent[]): string => {
  const now = new Date()
  const stamp =
    `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}` +
    `T${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}${String(now.getUTCSeconds()).padStart(2, '0')}Z`
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Yike//一刻手帳//ZH',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uidSeed}@yikeday.com`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDateTime(e.dateKey, e.start)}`,
      `DTEND:${icsDateTime(e.dateKey, e.end)}`,
      `SUMMARY:${icsEscape(e.text || '（未命名時間塊）')}`
    )
    if (e.note?.trim()) lines.push(`DESCRIPTION:${icsEscape(e.note)}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

/** 撈一段日期範圍內所有時間塊，組成 .ics。沒有任何塊回 null。 */
export const rangeToIcs = (dayKeys: string[]): string | null => {
  const events: IcsEvent[] = []
  for (const k of dayKeys) {
    if (!localStorage.getItem(`pp:day:${k}`)) continue
    for (const b of loadDay(k).blocks) {
      events.push({ dateKey: k, start: b.start, end: b.end, text: b.text, note: b.note, uidSeed: `${k}-${b.id}` })
    }
  }
  return events.length ? buildIcs(events) : null
}
