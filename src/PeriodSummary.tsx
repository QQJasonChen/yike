// 期間總結（週/月共用）：自動統計 + 複製 MD + AI 總結 prompt
import { useMemo, useState } from 'react'
import { loadDay } from './storage'

const MOODS = ['😖', '🙁', '😐', '🙂', '😄']

interface Props {
  title: string // 例：本週總結 / 本月總結
  dayKeys: string[] // 期間內所有日期 key
  periodLabel: string // 例：Week 24（6/8–6/14）
}

interface Summary {
  recorded: number
  sessions: number
  minutes: number
  avgScore: string
  doneRate: number | null
  moodCounts: number[]
  acts: { name: string; days: number; sessions: number; minutes: number }[]
  highlights: string[]
}

const build = (dayKeys: string[]): Summary => {
  const map = new Map<string, { days: Set<string>; sessions: number; minutes: number }>()
  const touch = (n: string) => {
    if (!map.has(n)) map.set(n, { days: new Set(), sessions: 0, minutes: 0 })
    return map.get(n)!
  }
  let recorded = 0
  let sessions = 0
  let minutes = 0
  const scores: number[] = []
  const moodCounts = [0, 0, 0, 0, 0]
  let written = 0
  let completed = 0
  const highlights: string[] = []

  for (const k of dayKeys) {
    if (!localStorage.getItem(`pp:day:${k}`)) continue
    const d = loadDay(k)
    recorded++
    if (d.score) scores.push(d.score)
    if (d.mood) moodCounts[d.mood - 1]++
    const hl = d.answers.e0?.trim()
    if (hl) highlights.push(`${Number(k.slice(8, 10))}日：${hl}`)
    for (const t of d.tasks) {
      const n = t.text.trim()
      if (!n) continue
      written++
      if (t.completed) completed++
      sessions += t.done
      const e = touch(n)
      e.days.add(k)
      e.sessions += t.done
    }
    for (const b of d.blocks) {
      const n = b.text.trim()
      if (!n) continue
      minutes += b.end - b.start
      const e = touch(n)
      e.days.add(k)
      e.minutes += b.end - b.start
    }
  }

  return {
    recorded,
    sessions,
    minutes,
    avgScore: scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '–',
    doneRate: written ? Math.round((completed / written) * 100) : null,
    moodCounts,
    acts: [...map.entries()]
      .map(([name, e]) => ({ name, days: e.days.size, sessions: e.sessions, minutes: e.minutes }))
      .sort((a, b) => b.minutes + b.sessions * 30 - (a.minutes + a.sessions * 30))
      .slice(0, 8),
    highlights: highlights.slice(0, 10),
  }
}

const toMarkdown = (title: string, label: string, s: Summary): string => {
  const lines = [
    `## 📊 ${title}（${label}）`,
    '',
    `記錄 ${s.recorded} 天 ｜ 專注 ${s.sessions} 段 ｜ 排程 ${Math.round((s.minutes / 60) * 10) / 10} 小時 ｜ 平均評分 ${s.avgScore}${s.doneRate !== null ? ` ｜ 任務完成率 ${s.doneRate}%` : ''}`,
    '',
    '### 活動投入',
    ...s.acts.map(
      (a) =>
        `- ${a.name}：${a.days} 天${a.sessions ? `・專注 ${a.sessions} 段` : ''}${a.minutes ? `・${Math.round((a.minutes / 60) * 10) / 10} 小時` : ''}`
    ),
  ]
  if (s.highlights.length) lines.push('', '### 每日亮點', ...s.highlights.map((h) => `- ${h}`))
  return lines.join('\n') + '\n'
}

const AI_PROMPT = `你是我的生產力教練。以下是我這個期間的手帳統計（活動投入、評分、心情、亮點）。請幫我寫一段誠實的總結（繁體中文）：

1. 這段期間我的時間實際流向哪裡？跟我宣稱的優先級一致嗎？
2. 最值得肯定的一件事、最該警惕的一個模式
3. 下個期間的三個具體調整

直接、具體、不要客套。

---

`

export default function PeriodSummary({ title, dayKeys, periodLabel }: Props) {
  const s = useMemo(() => build(dayKeys), [dayKeys])
  const [copied, setCopied] = useState<'' | 'md' | 'ai'>('')

  if (s.recorded === 0) return null

  const copy = async (kind: 'md' | 'ai') => {
    const md = toMarkdown(title, periodLabel, s)
    try {
      await navigator.clipboard.writeText(kind === 'ai' ? AI_PROMPT + md : md)
      setCopied(kind)
      setTimeout(() => setCopied(''), 2000)
    } catch {
      alert('複製失敗')
    }
  }

  return (
    <div className="psum">
      <div className="label">
        {title}{' '}
        <span className="hint">
          記錄 {s.recorded} 天・專注 {s.sessions} 段・排程{' '}
          {Math.round((s.minutes / 60) * 10) / 10} 小時・評分 {s.avgScore}
          {s.moodCounts.some((c) => c > 0) &&
            '・' + MOODS.map((m, i) => (s.moodCounts[i] ? `${m}${s.moodCounts[i]}` : '')).join('')}
        </span>
      </div>
      {s.acts.length > 0 && (
        <table className="act-table">
          <tbody>
            {s.acts.map((a) => (
              <tr key={a.name}>
                <td className="act-name">{a.name}</td>
                <td>{a.days} 天</td>
                <td>{a.sessions ? `${a.sessions} 段` : '–'}</td>
                <td>{a.minutes ? `${Math.round((a.minutes / 60) * 10) / 10} 小時` : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="data-actions" style={{ marginTop: 12 }}>
        <button onClick={() => copy('md')}>{copied === 'md' ? '✓ 已複製' : '⧉ 複製總結 MD'}</button>
        <button onClick={() => copy('ai')} title="複製統計＋教練指令，貼到 Claude / ChatGPT 生成文字總結">
          {copied === 'ai' ? '✓ 已複製，貼到 AI' : '🤖 AI 寫總結'}
        </button>
      </div>
    </div>
  )
}
