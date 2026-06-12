import { DayEntry } from './types'

const MOODS = ['😖', '🙁', '😐', '🙂', '😄']
const WD = ['日', '一', '二', '三', '四', '五', '六']

const fmtMin = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

/** 把一天的手帳轉成 Markdown（貼 Heptabase / Notion 用） */
export const dayToMarkdown = (
  dateKey: string,
  e: DayEntry,
  morningQs: string[],
  eveningQs: string[]
): string => {
  const d = new Date(`${dateKey}T12:00:00`)
  const lines: string[] = [`## 📒 一刻手帳 ${dateKey}（${WD[d.getDay()]}）`, '']

  const morning = morningQs
    .map((q, i) => ({ q, a: e.answers[`m${i}`] ?? '' }))
    .filter((x) => x.a)
  morning.forEach((x) => lines.push(`**${x.q}**：${x.a}`))
  if (morning.length) lines.push('')

  const tasks = e.tasks.filter((t) => t.text.trim())
  if (tasks.length) {
    lines.push('### 任務')
    e.tasks.forEach((t, i) => {
      if (!t.text.trim()) return
      const star = i === 0 ? '★ ' : ''
      const focus = t.done > 0 ? `（專注 ${t.done} 段${t.target ? `／目標 ${t.target}` : ''}）` : ''
      lines.push(`- [${t.completed ? 'x' : ' '}] ${star}${t.text}${focus}`)
    })
    lines.push('')
  }

  const blocks = [...e.blocks].sort((a, b) => a.start - b.start)
  if (blocks.length) {
    lines.push('### 時間軸')
    blocks.forEach((b) => lines.push(`- ${fmtMin(b.start)}–${fmtMin(b.end)} ${b.text || '（未命名）'}`))
    lines.push('')
  }

  const evening = eveningQs
    .map((q, i) => ({ q, a: e.answers[`e${i}`] ?? '' }))
    .filter((x) => x.a)
  if (evening.length) {
    lines.push('### 反思')
    evening.forEach((x) => lines.push(`- **${x.q}**：${x.a}`))
    lines.push('')
  }

  const meta: string[] = []
  if (e.mood) meta.push(`心情 ${MOODS[e.mood - 1]}`)
  if (e.score) meta.push(`生產力 ${e.score}/5`)
  if (e.habit) meta.push('習慣 ✅')
  if (meta.length) lines.push(meta.join(' ｜ '))

  return lines.join('\n').trim() + '\n'
}
