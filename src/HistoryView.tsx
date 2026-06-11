import { useMemo, useRef } from 'react'
import {
  addDays,
  allDayKeys,
  currentStreak,
  exportAll,
  importAll,
  loadDay,
  toDateKey,
} from './storage'
import { Settings } from './types'

const MOODS = ['😖', '🙁', '😐', '🙂', '😄']
const WD = ['日', '一', '二', '三', '四', '五', '六']

interface Props {
  onOpenDay: (dateKey: string) => void
  settings: Settings
  onSettingsChange: (s: Settings) => void
}

export default function HistoryView({ onOpenDay, settings, onSettingsChange }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const todayKey = toDateKey(new Date())

  const { keys, days, streak, avgScore, totalSessions } = useMemo(() => {
    const keys = allDayKeys()
    const days = new Map(keys.map((k) => [k, loadDay(k)]))
    const scores = [...days.values()].map((d) => d.score).filter((s): s is number => s !== null)
    const totalSessions = [...days.values()].reduce(
      (sum, d) => sum + d.tasks.reduce((s, t) => s + t.done, 0),
      0
    )
    return {
      keys,
      days,
      streak: currentStreak(todayKey),
      avgScore: scores.length
        ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)
        : '–',
      totalSessions,
    }
  }, [todayKey])

  // 近 14 天評分長條圖
  const chartDays = Array.from({ length: 14 }, (_, i) => addDays(todayKey, i - 13))

  const doExport = () => {
    const blob = new Blob([exportAll()], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `productivity-planner-${todayKey}.json`
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
        </div>

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
            <span key={k}>{WD[new Date(k).getDay() >= 0 ? new Date(`${k}T12:00:00`).getDay() : 0]}</span>
          ))}
        </div>

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
              <span className="hist-date">{k.slice(5).replace('-', '/')}（{WD[new Date(`${k}T12:00:00`).getDay()]}）</span>
              <span className={`hist-mit ${mit ? '' : 'empty'}`}>{mit || '（沒有寫最重要任務）'}</span>
              {d.mood && <span>{MOODS[d.mood - 1]}</span>}
              {sessions > 0 && <span className="hist-score">{sessions}⊙</span>}
              <span className="hist-score">{d.score ? `${d.score}/5` : ''}</span>
            </button>
          )
        })}

        <div className="data-actions">
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

        <div className="settings-row">
          <span>Focus Time 長度</span>
          <select
            value={settings.focusMinutes}
            onChange={(e) => onSettingsChange({ ...settings, focusMinutes: Number(e.target.value) })}
          >
            {[25, 30, 35, 40, 45, 50].map((m) => (
              <option key={m} value={m}>
                {m} 分鐘
              </option>
            ))}
          </select>
          <span>休息</span>
          <select
            value={settings.breakMinutes}
            onChange={(e) => onSettingsChange({ ...settings, breakMinutes: Number(e.target.value) })}
          >
            {[5, 10, 15].map((m) => (
              <option key={m} value={m}>
                {m} 分鐘
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
