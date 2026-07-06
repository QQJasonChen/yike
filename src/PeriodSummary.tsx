// 期間總結（週/月共用）：自動統計 + 複製 MD + AI 總結 prompt
import { useMemo, useState } from 'react'
import { aiEnabled, generateInsight } from './ai'
import { loadDay } from './storage'
import { treeTier } from './plantCells'
import { TIER_NAME, treeGlyph } from './plantGlyphs'

const MOODS = ['😖', '🙁', '😐', '🙂', '😄']

interface Props {
  title: string // 例：本週總結 / 本月總結
  dayKeys: string[] // 期間內所有日期 key
  periodLabel: string // 例：Week 24（6/8–6/14）
  showGrove?: boolean // 種樹模式才顯示「這段期間的樹林」
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
  trees: { pine: number; lush: number; cherry: number; total: number }
  withered: number
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
  const trees = { pine: 0, lush: 0, cherry: 0, total: 0 }
  let withered = 0

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
      // 樹林：每棵種下的樹依 grove 記的分鐘數歸類（無 grove 的舊資料當松樹）
      for (let i = 0; i < t.done; i++) {
        trees[treeTier(t.grove?.[i] ?? 25)]++
        trees.total++
      }
      withered += t.withered ?? 0
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
    trees,
    withered,
  }
}

const toMarkdown = (title: string, label: string, s: Summary): string => {
  const lines = [
    `## 📊 ${title}（${label}）`,
    '',
    `記錄 ${s.recorded} 天 ｜ 專注 ${s.sessions} 段 ｜ 排程 ${Math.round((s.minutes / 60) * 10) / 10} 小時 ｜ 平均評分 ${s.avgScore}${s.doneRate !== null ? ` ｜ 任務完成率 ${s.doneRate}%` : ''}`,
    ...(s.trees.total > 0
      ? [
          `🌳 種樹：松樹 ${s.trees.pine}・茂密樹 ${s.trees.lush}・櫻花 ${s.trees.cherry}・共 ${s.trees.total} 棵${s.withered > 0 ? `（枯 ${s.withered}）` : ''}`,
        ]
      : []),
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

export default function PeriodSummary({ title, dayKeys, periodLabel, showGrove }: Props) {
  const s = useMemo(() => build(dayKeys), [dayKeys])
  const [copied, setCopied] = useState<'' | 'md' | 'ai'>('')
  const [aiText, setAiText] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiErr, setAiErr] = useState('')

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

  const runAI = async () => {
    setAiBusy(true)
    setAiErr('')
    setAiText('')
    try {
      const md = toMarkdown(title, periodLabel, s)
      setAiText(await generateInsight(AI_PROMPT, md))
    } catch (e) {
      setAiErr(e instanceof Error ? e.message : 'AI 失敗')
    } finally {
      setAiBusy(false)
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
      {showGrove && (s.trees.total > 0 || s.withered > 0) && (
        <div className="grove-summary">
          {([
            ['pine', s.trees.pine],
            ['lush', s.trees.lush],
            ['cherry', s.trees.cherry],
          ] as const).map(
            ([tier, n]) =>
              n > 0 && (
                <span key={tier} className={`grove-item ${tier === 'cherry' ? 'cherry' : 'tree'}`} title={TIER_NAME[tier]}>
                  {treeGlyph(tier)}
                  <em>×{n}</em>
                </span>
              )
          )}
          <span className="grove-total">共 {s.trees.total} 棵</span>
          {s.withered > 0 && <span className="grove-wither">枯 {s.withered}</span>}
        </div>
      )}
      {s.acts.length > 0 && (
        <table className="act-table">
          <thead>
            <tr>
              <th>活動</th>
              <th>天</th>
              <th>專注</th>
              <th>排程</th>
            </tr>
          </thead>
          <tbody>
            {s.acts.map((a) => (
              <tr key={a.name}>
                <td className="act-name">{a.name}</td>
                <td>{a.days}</td>
                <td>{a.sessions ? `${a.sessions} 段` : '–'}</td>
                <td>{a.minutes ? `${Math.round((a.minutes / 60) * 10) / 10} 小時` : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="data-actions" style={{ marginTop: 12 }}>
        <button onClick={() => copy('md')}>{copied === 'md' ? '✓ 已複製' : '⧉ 複製總結 MD'}</button>
        {aiEnabled() && (
          <button onClick={runAI} disabled={aiBusy} title="用 AI 直接生成這段期間的回顧與洞察">
            {aiBusy ? 'AI 分析中⋯' : '🤖 AI 寫總結'}
          </button>
        )}
        <button
          className="link-btn"
          onClick={() => copy('ai')}
          title="複製統計＋指令，貼到你自己的 ChatGPT / Claude"
        >
          {copied === 'ai' ? '✓ 已複製' : '或複製給自己的 AI'}
        </button>
      </div>
      {aiErr && <p className="ai-status err">✗ {aiErr}</p>}
      {aiText && (
        <div className="ai-result">
          <div className="ai-result-head">
            🤖 AI 洞察
            <button className="ai-copy" onClick={() => navigator.clipboard.writeText(aiText)}>
              複製
            </button>
          </div>
          <div className="ai-result-body">{aiText}</div>
        </div>
      )}
    </div>
  )
}
