import { useMemo, useRef, useState } from 'react'
import {
  addDays,
  allDayKeys,
  nameStats,
  currentStreak,
  exportAll,
  importAll,
  loadDay,
  mondayOf,
  toDateKey,
} from './storage'
import { dayToMarkdown } from './exportMd'
import { Settings } from './types'

const AI_COACH_PROMPT = `你是一位犀利但溫暖的生產力教練。以下是我最近的每日手帳記錄（最重要任務、專注時段、時間軸、反思、心情與評分）。請分析：

1. **模式**：我的高分日和低分日各有什麼共同點？（時間安排、任務類型、心情）
2. **能量**：從時間軸看，我什麼時段最有產出？哪些安排在消耗我？
3. **誠實的提醒**：有沒有我一直拖延或重複出現的任務？背後可能是什麼？
4. **下週三個具體行動**：基於以上，給我三個明確可執行的調整。

請用繁體中文回答，直接、具體、不要客套。

---

`

const MOODS = ['😖', '🙁', '😐', '🙂', '😄']
const WD = ['日', '一', '二', '三', '四', '五', '六']

const PERIODS = [
  { key: 'all', label: '全部' },
  { key: 'year', label: '今年' },
  { key: 'quarter', label: '本季' },
  { key: 'month', label: '本月' },
  { key: 'week', label: '本週' },
] as const

interface Props {
  onOpenDay: (dateKey: string) => void
  settings: Settings
}

export default function HistoryView({ onOpenDay, settings }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const todayKey = toDateKey(new Date())
  const [coachCopied, setCoachCopied] = useState(false)
  // Markdown 區間匯出
  const [mdFrom, setMdFrom] = useState(() => addDays(toDateKey(new Date()), -6))
  const [mdTo, setMdTo] = useState(() => toDateKey(new Date()))
  const [mdCopied, setMdCopied] = useState(false)
  // 活動統計期間
  const [period, setPeriod] = useState<string>('all')
  const statRange = (): { from?: string; to?: string } => {
    if (period === 'all') return {}
    const to = todayKey
    const y = todayKey.slice(0, 4)
    const m = Number(todayKey.slice(5, 7))
    if (period === 'year') return { from: `${y}-01-01`, to }
    if (period === 'month') return { from: `${todayKey.slice(0, 7)}-01`, to }
    if (period === 'quarter') {
      const qm = Math.floor((m - 1) / 3) * 3 + 1
      return { from: `${y}-${String(qm).padStart(2, '0')}-01`, to }
    }
    if (period === 'week') return { from: mondayOf(todayKey), to }
    return {}
  }

  // AI 教練：複製最近 7 天記錄 + 分析 prompt
  const copyCoach = async () => {
    const recent = allDayKeys().slice(0, 7).reverse()
    if (recent.length === 0) {
      alert('還沒有任何記錄，先寫幾天再來找教練吧。')
      return
    }
    const body = recent
      .map((k) => dayToMarkdown(k, loadDay(k), settings.morningQs, settings.eveningQs))
      .join('\n')
    try {
      await navigator.clipboard.writeText(AI_COACH_PROMPT + body)
      setCoachCopied(true)
      setTimeout(() => setCoachCopied(false), 2500)
    } catch {
      alert('複製失敗')
    }
  }

  // 區間 MD：把 from→to 之間「有記錄」的每天串成一份 Markdown 複製
  const copyRangeMD = async () => {
    const lo = mdFrom <= mdTo ? mdFrom : mdTo
    const hi = mdFrom <= mdTo ? mdTo : mdFrom
    const inRange = allDayKeys()
      .filter((k) => k >= lo && k <= hi)
      .sort()
    if (inRange.length === 0) {
      alert('這段日期內沒有任何記錄。')
      return
    }
    const md = inRange
      .map((k) => dayToMarkdown(k, loadDay(k), settings.morningQs, settings.eveningQs))
      .join('\n\n---\n\n')
    try {
      await navigator.clipboard.writeText(md)
      setMdCopied(true)
      setTimeout(() => setMdCopied(false), 2500)
    } catch {
      alert('複製失敗')
    }
  }

  const { keys, days, streak, avgScore, totalSessions, doneRate, moodCounts } = useMemo(() => {
    const keys = allDayKeys()
    const days = new Map(keys.map((k) => [k, loadDay(k)]))
    const all = [...days.values()]
    const scores = all.map((d) => d.score).filter((s): s is number => s !== null)
    const totalSessions = all.reduce((sum, d) => sum + d.tasks.reduce((s, t) => s + t.done, 0), 0)
    const written = all.flatMap((d) => d.tasks.filter((t) => t.text.trim()))
    const doneRate = written.length
      ? Math.round((written.filter((t) => t.completed).length / written.length) * 100)
      : null
    const moodCounts = [0, 0, 0, 0, 0]
    all.forEach((d) => d.mood && moodCounts[d.mood - 1]++)
    return {
      keys,
      days,
      streak: currentStreak(todayKey),
      avgScore: scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '–',
      totalSessions,
      doneRate,
      moodCounts,
    }
  }, [todayKey])

  // 近 14 天評分長條圖
  const chartDays = Array.from({ length: 14 }, (_, i) => addDays(todayKey, i - 13))

  const doExport = () => {
    const blob = new Blob([exportAll()], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `yike-${todayKey}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const doImport = (file: File) => {
    file.text().then((txt) => {
      try {
        const n = importAll(txt)
        alert(`已匯入 ${n} 筆資料，重新整理後生效。`)
        location.reload()
      } catch {
        alert('匯入失敗：檔案格式不正確')
      }
    })
  }

  return (
    <div className="page">
      <div className="page-inner">
        <h2 className="section-title">Review</h2>
        <p className="section-sub">看見自己的模式，就是進步的開始</p>

        <div className="hist-summary">
          <div className="hist-stat">
            <div className="num">{streak}</div>
            <div className="cap">連續記錄天數</div>
          </div>
          <div className="hist-stat">
            <div className="num">{keys.length}</div>
            <div className="cap">累計記錄天數</div>
          </div>
          <div className="hist-stat">
            <div className="num">{avgScore}</div>
            <div className="cap">平均生產力評分</div>
          </div>
          <div className="hist-stat">
            <div className="num">{totalSessions}</div>
            <div className="cap">累計 FOCUS 時段</div>
          </div>
          <div className="hist-stat">
            <div className="num">{Math.round((totalSessions * settings.focusMinutes) / 6) / 10}</div>
            <div className="cap">累計專注小時</div>
          </div>
          <div className="hist-stat">
            <div className="num">{doneRate !== null ? `${doneRate}%` : '–'}</div>
            <div className="cap">任務完成率</div>
          </div>
        </div>

        {moodCounts.some((c) => c > 0) && (
          <div className="mood-stats">
            {MOODS.map((m, i) =>
              moodCounts[i] > 0 ? (
                <span key={i} className="mood-stat">
                  {m}
                  <em>×{moodCounts[i]}</em>
                </span>
              ) : null
            )}
          </div>
        )}

        <div className="label">近 14 天生產力評分</div>
        <div className="chart">
          {chartDays.map((k) => {
            const score = days.get(k)?.score ?? 0
            return (
              <div
                key={k}
                className={`bar ${score === 0 ? 'empty-bar' : ''}`}
                style={{ height: `${Math.max(4, score * 20)}%` }}
                title={`${k}：${score || '未評分'}`}
              />
            )
          })}
        </div>
        <div className="chart-labels">
          {chartDays.map((k) => (
            <span key={k}>{WD[new Date(`${k}T12:00:00`).getDay()]}</span>
          ))}
        </div>

        <div className="label">
          活動統計 <span className="hint">同名才會合併——輸入時點選建議名稱，數據就會對齊</span>
        </div>
        <div className="period-tabs">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              className={`period-tab ${period === p.key ? 'on' : ''}`}
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {(() => {
          const r = statRange()
          const stats = nameStats(r.from, r.to).slice(0, 12)
          if (stats.length === 0)
            return <p className="wk-noresult">還沒有資料——開始記錄後這裡會自動總結。</p>
          return (
            <table className="act-table">
              <thead>
                <tr>
                  <th>活動</th>
                  <th>天數</th>
                  <th>專注段</th>
                  <th>時間軸</th>
                  <th>計畫</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.name}>
                    <td className="act-name">{s.name}</td>
                    <td>{s.days}</td>
                    <td>{s.sessions > 0 ? `${s.sessions} 段` : '–'}</td>
                    <td>{s.minutes > 0 ? `${Math.round((s.minutes / 60) * 10) / 10} 小時` : '–'}</td>
                    <td>{s.plans > 0 ? `${s.plans} 次` : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        })()}

        <div className="label">所有記錄</div>
        {keys.length === 0 && (
          <p style={{ color: 'var(--ink-faint)', fontFamily: 'var(--hand)', padding: '12px 4px' }}>
            還沒有任何記錄。回到「今天」，寫下你的最重要任務吧。
          </p>
        )}
        {keys.map((k) => {
          const d = days.get(k)!
          const mit = d.tasks[0]?.text
          const sessions = d.tasks.reduce((s, t) => s + t.done, 0)
          return (
            <button key={k} className="hist-row" onClick={() => onOpenDay(k)}>
              <span className="hist-date">
                {k.slice(5).replace('-', '/')}（{WD[new Date(`${k}T12:00:00`).getDay()]}）
              </span>
              <span className={`hist-mit ${mit ? '' : 'empty'}`}>{mit || '（沒有寫最重要任務）'}</span>
              {d.mood && <span>{MOODS[d.mood - 1]}</span>}
              {sessions > 0 && <span className="hist-score">{sessions}⊙</span>}
              <span className="hist-score">{d.score ? `${d.score}/5` : ''}</span>
            </button>
          )
        })}

        <div className="data-actions">
          <button onClick={copyCoach} title="複製近 7 天記錄＋分析指令，貼到 Claude / ChatGPT">
            {coachCopied ? '✓ 已複製，貼到 AI 即可' : '🤖 AI 教練分析'}
          </button>
          <button onClick={doExport}>匯出備份 JSON</button>
          <label>
            匯入備份
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              style={{ display: 'none' }}
              onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])}
            />
          </label>
        </div>

        <div className="label" style={{ marginTop: 18 }}>
          Markdown 區間匯出 <span className="hint">選一段日期，一次複製多天（貼 Heptabase / Notion / 週月報）</span>
        </div>
        <div className="md-range">
          <input type="date" value={mdFrom} max={mdTo} onChange={(e) => setMdFrom(e.target.value)} />
          <span className="md-range-sep">→</span>
          <input type="date" value={mdTo} min={mdFrom} onChange={(e) => setMdTo(e.target.value)} />
          <button className="md-range-btn" onClick={copyRangeMD}>
            {mdCopied ? '✓ 已複製' : '⧉ 複製這段 MD'}
          </button>
        </div>
      </div>
    </div>
  )
}
