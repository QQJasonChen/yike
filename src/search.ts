// 全領域搜尋：掃過所有 localStorage 紀錄（日/週/月/季/年/願景），
// 回傳命中片段 + 跳轉目標，讓 app 直接帶你到那個畫面。
import { loadDay, loadLife, loadMonth, loadQuarter, loadWeek, loadYear } from './storage'

export type SearchTarget =
  | { tab: 'day'; dateKey: string }
  | { tab: 'week'; mondayKey: string }
  | { tab: 'month'; monthKey: string }
  | { tab: 'quarter'; quarterKey: string }
  | { tab: 'year'; yearNum: number }
  | { tab: 'life' }

export interface SearchHit {
  id: string
  kind: string // 任務／反思／時間塊／週意圖…
  when: string // 人類可讀時間標籤
  text: string
  sort: string // 排序鍵（時間，新到舊）
  target: SearchTarget
}

const keysWith = (prefix: string): string[] => {
  const out: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith(prefix)) out.push(k.slice(prefix.length))
  }
  return out
}

const md = (dk: string) => `${Number(dk.slice(5, 7))}/${Number(dk.slice(8, 10))}`

export const searchAll = (query: string, limit = 80): SearchHit[] => {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: SearchHit[] = []
  const add = (
    text: string | undefined,
    kind: string,
    when: string,
    sort: string,
    target: SearchTarget,
    id: string
  ) => {
    if (text && text.toLowerCase().includes(q)) hits.push({ id, kind, when, text, sort, target })
  }

  // 日
  for (const dk of keysWith('pp:day:')) {
    const d = loadDay(dk)
    const when = md(dk)
    d.tasks.forEach((t, i) => add(t.text, '任務', when, dk, { tab: 'day', dateKey: dk }, `d${dk}t${i}`))
    d.blocks.forEach((b, i) => {
      add(b.text, '時間塊', when, dk, { tab: 'day', dateKey: dk }, `d${dk}b${i}`)
      add(b.note, '時間塊筆記', when, dk, { tab: 'day', dateKey: dk }, `d${dk}bn${i}`)
    })
    Object.entries(d.answers).forEach(([qk, v]) =>
      add(v, '反思', when, dk, { tab: 'day', dateKey: dk }, `d${dk}a${qk}`)
    )
  }
  // 週
  for (const mk of keysWith('pp:week:')) {
    const w = loadWeek(mk)
    const when = `週 ${md(mk)}`
    add(w.intention, '週意圖', when, mk, { tab: 'week', mondayKey: mk }, `w${mk}i`)
    w.tasks.forEach((t, i) =>
      add(t.text, '週任務', when, mk, { tab: 'week', mondayKey: mk }, `w${mk}t${i}`)
    )
    ;(['wins', 'notCompleted', 'learned', 'nextWeek'] as const).forEach((f) =>
      add(w.review[f], '週復盤', when, mk, { tab: 'week', mondayKey: mk }, `w${mk}r${f}`)
    )
  }
  // 月
  for (const mk of keysWith('pp:month:')) {
    const m = loadMonth(mk)
    const when = `${mk.slice(0, 4)}/${Number(mk.slice(5, 7))} 月`
    m.priorities.forEach((p, i) =>
      add(p.text, '月優先', when, `${mk}-01`, { tab: 'month', monthKey: mk }, `m${mk}p${i}`)
    )
    add(m.highlights, '月亮點', when, `${mk}-01`, { tab: 'month', monthKey: mk }, `m${mk}h`)
  }
  // 季
  for (const qk of keysWith('pp:quarter:')) {
    const qe = loadQuarter(qk)
    const when = `${qk.slice(0, 4)} ${qk.slice(5)}`
    const sort = `${qk.slice(0, 4)}-${Number(qk.slice(6)) * 3}`
    qe.priorities.forEach((p, i) =>
      add(p.text, '季優先', when, sort, { tab: 'quarter', quarterKey: qk }, `q${qk}p${i}`)
    )
    add(qe.highlights, '季亮點', when, sort, { tab: 'quarter', quarterKey: qk }, `q${qk}h`)
  }
  // 年
  for (const yk of keysWith('pp:year:')) {
    const y = loadYear(yk)
    const yn = Number(yk)
    const when = `${yk} 年`
    y.goals.forEach((g, i) =>
      add(g.text, '年目標', when, `${yk}-13`, { tab: 'year', yearNum: yn }, `y${yk}g${i}`)
    )
    y.monthFocus.forEach((f, i) =>
      add(f, '月主題', `${yk}/${i + 1}`, `${yk}-${i + 1}`, { tab: 'year', yearNum: yn }, `y${yk}f${i}`)
    )
    Object.entries(y.notes).forEach(([dk, v]) =>
      add(v, '年筆記', md(dk), dk, { tab: 'year', yearNum: yn }, `y${yk}n${dk}`)
    )
  }
  // 願景
  const life = loadLife()
  add(life.northStar, '北極星', '願景', '9999', { tab: 'life' }, 'lns')
  life.goals.forEach((g, i) => add(g.text, '願景目標', '願景', '9999', { tab: 'life' }, `lg${i}`))
  life.odyssey.forEach((o, i) => add(o.body, '奧德賽', o.title, '9999', { tab: 'life' }, `lo${i}`))

  hits.sort((a, b) => (a.sort < b.sort ? 1 : a.sort > b.sort ? -1 : 0)) // 新到舊
  return hits.slice(0, limit)
}
