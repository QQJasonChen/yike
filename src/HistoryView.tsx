import { useMemo, useRef, useState } from 'react'
import {
  addDays,
  allDayKeys,
  currentStreak,
  exportAll,
  importAll,
  loadDay,
  loadSync,
  saveSync,
  syncDownload,
  syncUpload,
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
  const [sync, setSync] = useState(loadSync)
  const [syncMsg, setSyncMsg] = useState('')
  const [syncing, setSyncing] = useState(false)

  const updateSyncToken = (token: string) => {
    const next = { ...sync, token }
    setSync(next)
    saveSync(next)
  }

  const doSync = async (dir: 'up' | 'down') => {
    setSyncing(true)
    setSyncMsg(dir === 'up' ? '上傳中⋯' : '下載中⋯')
    try {
      if (dir === 'up') {
        const cfg = await syncUpload()
        setSync(cfg)
        setSyncMsg('✓ 已上傳到你的私人 Gist')
      } else {
        const n = await syncDownload()
        setSync(loadSync())
        setSyncMsg(`✓ 已合併 ${n} 筆雲端資料，重新整理生效`)
        setTimeout(() => location.reload(), 1200)
      }
    } catch (e) {
      setSyncMsg(`✗ ${e instanceof Error ? e.message : '同步失敗'}`)
    } finally {
      setSyncing(false)
    }
  }

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

        <div className="label" style={{ justifyContent: 'center', marginTop: 30 }}>
          跨裝置同步
        </div>
        <div className="sync-box">
          <p className="sync-help">
            用你自己的 GitHub 帳號當免費雲端：到{' '}
            <a href="https://github.com/settings/tokens/new?scopes=gist&description=InkDay+Sync" target="_blank" rel="noreferrer">
              github.com/settings/tokens
            </a>{' '}
            建一個只勾 <code>gist</code> 權限的 token，貼到下面。每台裝置貼同一個 token，
            就能「上傳」→ 換裝置「下載」。資料存在你帳號的私人 Gist，別人看不到。
          </p>
          <div className="line-input sync-token">
            <input
              type="password"
              placeholder="ghp_xxxx⋯（GitHub token，只存在這台裝置）"
              value={sync.token}
              onChange={(e) => updateSyncToken(e.target.value.trim())}
            />
          </div>
          <div className="data-actions" style={{ marginTop: 12 }}>
            <button disabled={syncing || !sync.token} onClick={() => doSync('up')}>
              ⬆ 上傳到雲端
            </button>
            <button disabled={syncing || !sync.token} onClick={() => doSync('down')}>
              ⬇ 從雲端下載
            </button>
          </div>
          {(syncMsg || sync.lastSync) && (
            <p className="sync-status">
              {syncMsg}
              {!syncMsg && sync.lastSync && `上次同步：${new Date(sync.lastSync).toLocaleString()}`}
            </p>
          )}
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
