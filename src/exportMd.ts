import { DayEntry } from './types'

const MOODS = ['😖', '🙁', '😐', '🙂', '😄']
const WD = ['日', '一', '二', '三', '四', '五', '六']

const fmtMin = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

/** 把一天的手帳轉成 Markdown（貼 Heptabase / Notion 用） */
export const dayToMarkdown = (dateKey: string, e: DayEntry): string => {
  const d = new Date(`${dateKey}T12:00:00`)
  const lines: string[] = [`## 📒 日刻手帳 ${dateKey}（${WD[d.getDay()]}）`, '']

  if (e.gratitude) lines.push(`**我感謝**：${e.gratitude}`)
  if (e.intention) lines.push(`**今日意圖**：${e.intention}`)
  if (e.gratitude || e.intention) lines.push('')

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

  const refl: string[] = []
  if (e.highlight) refl.push(`- **今日亮點**：${e.highlight}`)
  if (e.learned) refl.push(`- **學到了**：${e.learned}`)
  if (e.remember) refl.push(`- **想記住**：${e.remember}`)
  if (refl.length) {
    lines.push('### 反思', ...refl, '')
  }

  const meta: string[] = []
  if (e.mood) meta.push(`心情 ${MOODS[e.mood - 1]}`)
  if (e.score) meta.push(`生產力 ${e.score}/5`)
  if (e.habit) meta.push('習慣 ✅')
  if (meta.length) lines.push(meta.join(' ｜ '))

  return lines.join('\n').trim() + '\n'
}
