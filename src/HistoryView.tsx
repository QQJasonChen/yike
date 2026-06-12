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
import { useEffect } from 'react'
import { cloudEnabled, currentEmail, sendCode, signOut, startAutoSync, stopAutoSync, syncNow, verifyCode } from './cloud'
import { dayToMarkdown } from './exportMd'
import { DEFAULT_EVENING_QS, DEFAULT_MORNING_QS, Settings } from './types'

// Graham Weaver 晨間三問（QQ 的每日框架）
const WEAVER_MORNING_QS = [
  '寫下 3 件能推進主線的事',
  '今天的目標宣言（現在式）：「我是＿＿」',
  '我今天在玩什麼 different game？',
]

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
  const [coachCopied, setCoachCopied] = useState(false)
  const [showQEditor, setShowQEditor] = useState(false)
  const [mDraft, setMDraft] = useState(() => settings.morningQs.join('\n'))
  const [eDraft, setEDraft] = useState(() => settings.eveningQs.join('\n'))

  // ---- 帳號制雲端同步（Supabase）----
  const [cloudEmail, setCloudEmail] = useState('')
  const [cloudCode, setCloudCode] = useState('')
  const [cloudStage, setCloudStage] = useState<'out' | 'code' | 'in'>('out')
  const [cloudUser, setCloudUser] = useState<string | null>(null)
  const [cloudMsg, setCloudMsg] = useState('')

  useEffect(() => {
    if (!cloudEnabled()) return
    currentEmail().then((e) => {
      if (e) {
        setCloudUser(e)
        setCloudStage('in')
      }
    })
  }, [])

  const cloudAct = async (act: () => Promise<void>) => {
    try {
      setCloudMsg('處理中⋯')
      await act()
    } catch (e) {
      setCloudMsg(`✗ ${e instanceof Error ? e.message : '失敗'}`)
    }
  }

  const saveQs = (m: string, e: string) =>
    onSettingsChange({
      ...settings,
      morningQs: m.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 6),
      eveningQs: e.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 6),
    })

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
      avgScore: scores.length
        ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)
        : '–',
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
          <div className="hist-stat">
            <div className="num">
              {Math.round((totalSessions * settings.focusMinutes) / 6) / 10}
            </div>
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
          <button onClick={() => setShowQEditor((v) => !v)}>✎ 自訂每日問題</button>
        </div>

        {showQEditor && (
          <div className="sync-box" style={{ marginTop: 14 }}>
            <p className="sync-help">
              一行一個問題，存了之後「今天」頁立即生效。把日刻手帳變成<b>你的</b>方法。
            </p>
            <div className="label" style={{ marginTop: 10 }}>晨間問題</div>
            <textarea
              className="line-area"
              rows={4}
              value={mDraft}
              onChange={(e) => setMDraft(e.target.value)}
            />
            <div className="label">晚間問題</div>
            <textarea
              className="line-area"
              rows={4}
              value={eDraft}
              onChange={(e) => setEDraft(e.target.value)}
            />
            <div className="data-actions" style={{ marginTop: 12 }}>
              <button onClick={() => saveQs(mDraft, eDraft)}>儲存問題</button>
              <button
                onClick={() => {
                  const m = DEFAULT_MORNING_QS.join('\n')
                  const e = DEFAULT_EVENING_QS.join('\n')
                  setMDraft(m)
                  setEDraft(e)
                  saveQs(m, e)
                }}
              >
                日刻法預設
              </button>
              <button
                title="Graham Weaver 的晨間框架"
                onClick={() => {
                  const m = WEAVER_MORNING_QS.join('\n')
                  setMDraft(m)
                  saveQs(m, eDraft)
                }}
              >
                Weaver 三問
              </button>
            </div>
          </div>
        )}

        {cloudEnabled() && (
          <>
            <div className="label" style={{ justifyContent: 'center', marginTop: 30 }}>
              雲端同步（帳號制）
            </div>
            <div className="sync-box">
              {cloudStage === 'out' && (
                <>
                  <p className="sync-help">
                    輸入 Email 取得 6 位數驗證碼，登入後所有裝置<b>自動同步</b>——寫完即上雲，換裝置打開就有。
                  </p>
                  <div className="line-input sync-token">
                    <input
                      type="email"
                      placeholder="你的 Email"
                      value={cloudEmail}
                      onChange={(e) => setCloudEmail(e.target.value.trim())}
                    />
                  </div>
                  <div className="data-actions" style={{ marginTop: 12 }}>
                    <button
                      disabled={!cloudEmail.includes('@')}
                      onClick={() =>
                        cloudAct(async () => {
                          await sendCode(cloudEmail)
                          setCloudStage('code')
                          setCloudMsg('驗證碼已寄出，請查收信箱')
                        })
                      }
                    >
                      寄送驗證碼
                    </button>
                  </div>
                </>
              )}
              {cloudStage === 'code' && (
                <>
                  <p className="sync-help">輸入寄到 {cloudEmail} 的 6 位數驗證碼：</p>
                  <div className="line-input sync-token">
                    <input
                      inputMode="numeric"
                      placeholder="123456"
                      value={cloudCode}
                      onChange={(e) => setCloudCode(e.target.value.trim())}
                    />
                  </div>
                  <div className="data-actions" style={{ marginTop: 12 }}>
                    <button
                      disabled={cloudCode.length < 6}
                      onClick={() =>
                        cloudAct(async () => {
                          await verifyCode(cloudEmail, cloudCode)
                          setCloudUser(cloudEmail)
                          setCloudStage('in')
                          const r = await syncNow()
                          await startAutoSync() // 登入即啟用自動推送，不用重新整理
                          setCloudMsg(`✓ 登入成功，已同步（↓${r.pulled} ↑${r.pushed}）`)
                          if (r.pulled > 0) setTimeout(() => location.reload(), 1000)
                        })
                      }
                    >
                      登入
                    </button>
                  </div>
                </>
              )}
              {cloudStage === 'in' && (
                <>
                  <p className="sync-help">
                    ✓ 已登入 <b>{cloudUser}</b>——寫入後幾秒內自動上雲；其他裝置打開時自動拉取。
                  </p>
                  <div className="data-actions" style={{ marginTop: 12 }}>
                    <button
                      onClick={() =>
                        cloudAct(async () => {
                          const r = await syncNow()
                          setCloudMsg(`✓ 已同步（↓${r.pulled} ↑${r.pushed}）`)
                          if (r.pulled > 0) setTimeout(() => location.reload(), 1000)
                        })
                      }
                    >
                      ⟳ 立即同步
                    </button>
                    <button
                      onClick={() =>
                        cloudAct(async () => {
                          await signOut()
                          stopAutoSync()
                          setCloudUser(null)
                          setCloudStage('out')
                          setCloudMsg('已登出（本機資料保留）')
                        })
                      }
                    >
                      登出
                    </button>
                  </div>
                </>
              )}
              {cloudMsg && <p className="sync-status">{cloudMsg}</p>}
            </div>
          </>
        )}

        <div className="label" style={{ justifyContent: 'center', marginTop: 30 }}>
          {cloudEnabled() ? '進階：Gist 同步（極客版）' : '跨裝置同步'}
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
