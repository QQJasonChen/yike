import { useMemo, useRef, useState } from 'react'
import {
  addDays,
  allDayKeys,
  nameStats,
  currentStreak,
  exportAll,
  importAll,
  loadDay,
  toDateKey,
} from './storage'
import { useEffect } from 'react'
import { activateLicense, cloudEnabled, currentEmail, signInOrUp, signOut, startAutoSync, stopAutoSync, syncNow } from './cloud'
import { dayToMarkdown } from './exportMd'
import { TextArea, TextField } from './fields'
import { focusLock } from './focusLock'
import { DEFAULT_EVENING_QS, DEFAULT_MORNING_QS, MAX_ROUTINES, ROUTINE_COLORS, RoutineItem, Settings } from './types'

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
  const [coachCopied, setCoachCopied] = useState(false)
  const [showQEditor, setShowQEditor] = useState(false)
  const [mDraft, setMDraft] = useState(() => settings.morningQs.join('\n'))
  const [eDraft, setEDraft] = useState(() => settings.eveningQs.join('\n'))

  // ---- 帳號制雲端同步（Supabase）----
  const [cloudEmail, setCloudEmail] = useState('')
  const [cloudPw, setCloudPw] = useState('')
  const [license, setLicense] = useState('')
  const [showLicense, setShowLicense] = useState(false)
  const [cloudStage, setCloudStage] = useState<'out' | 'in'>('out')
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

        <div className="label">
          活動統計 <span className="hint">同名才會合併——輸入時點選建議名稱，數據就會對齊</span>
        </div>
        {(() => {
          const stats = nameStats().slice(0, 12)
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
              一行一個問題，存了之後「今天」頁立即生效。把一刻手帳變成<b>你的</b>方法。
            </p>
            <div className="label" style={{ marginTop: 10 }}>晨間問題</div>
            <TextArea
              className="line-area"
              rows={4}
              value={mDraft}
              onValue={setMDraft}
            />
            <div className="label">晚間問題</div>
            <TextArea
              className="line-area"
              rows={4}
              value={eDraft}
              onValue={setEDraft}
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
                一刻預設
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
            <div id="cloud-sync" className="label" style={{ justifyContent: 'center', marginTop: 30 }}>
              雲端同步（帳號制）
            </div>
            <div className="sync-box">
              {cloudStage === 'out' && (
                <>
                  <p className="sync-help">
                    購買後，用<b>購買時填的 Email</b> ＋ 自設密碼登入即可，所有裝置<b>自動同步</b>——寫完即上雲、換裝置打開就有。
                    本機記錄與全部功能<b>不需帳號、永久免費</b>；雲端同步為付費功能。
                  </p>
                  <div className="line-input sync-token">
                    <input
                      type="email"
                      placeholder="你的 Email"
                      value={cloudEmail}
                      onChange={(e) => setCloudEmail(e.target.value.trim())}
                    />
                  </div>
                  <div className="line-input sync-token">
                    <input
                      type="password"
                      placeholder="密碼（至少 8 碼，請記好）"
                      value={cloudPw}
                      onChange={(e) => setCloudPw(e.target.value)}
                    />
                  </div>
                  {showLicense && (
                    <div className="line-input sync-token">
                      <input
                        placeholder="購買序號（Gumroad License Key）"
                        value={license}
                        onChange={(e) => setLicense(e.target.value.trim())}
                      />
                    </div>
                  )}
                  <div className="data-actions" style={{ marginTop: 12 }}>
                    {!showLicense ? (
                      <>
                        <button
                          disabled={!cloudEmail.includes('@') || cloudPw.length < 8}
                          onClick={() =>
                            cloudAct(async () => {
                              const mode = await signInOrUp(cloudEmail, cloudPw)
                              setCloudUser(cloudEmail)
                              setCloudStage('in')
                              const r = await syncNow()
                              await startAutoSync() // 登入即啟用自動推送
                              setCloudMsg(
                                `✓ ${mode === 'up' ? '開通成功' : '登入成功'}，已同步（↓${r.pulled} ↑${r.pushed}）`
                              )
                              if (r.pulled > 0) setTimeout(() => location.reload(), 1000)
                            })
                          }
                        >
                          登入
                        </button>
                        <button onClick={() => setShowLicense(true)}>🛒 我有購買序號</button>
                      </>
                    ) : (
                      <>
                        <button
                          disabled={!cloudEmail.includes('@') || cloudPw.length < 8 || license.length < 8}
                          onClick={() =>
                            cloudAct(async () => {
                              await activateLicense(license, cloudEmail, cloudPw)
                              setCloudUser(cloudEmail)
                              setCloudStage('in')
                              const r = await syncNow()
                              await startAutoSync()
                              setCloudMsg(`✓ 序號啟用成功，已同步（↓${r.pulled} ↑${r.pushed}）`)
                            })
                          }
                        >
                          啟用並登入
                        </button>
                        <button onClick={() => setShowLicense(false)}>返回登入</button>
                      </>
                    )}
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

        <div className="settings-row">
          <span>Focus Time 長度</span>
          <select
            value={settings.focusMinutes}
            onChange={(e) => onSettingsChange({ ...settings, focusMinutes: Number(e.target.value) })}
          >
            {[15, 20, 25, 30, 35, 40, 45, 50].map((m) => (
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

        <div className="settings-row focuslock-row">
          <span>昨日未完成提醒</span>
          <button
            className={`fl-toggle ${settings.showRollover ? 'on' : ''}`}
            onClick={() => onSettingsChange({ ...settings, showRollover: !settings.showRollover })}
          >
            {settings.showRollover ? '顯示中' : '已關閉'}
          </button>
          <span className="hint fl-hint">今天頁「昨天有 N 件未完成 → 帶入今天」的橫幅</span>
        </div>

        <FocusLockSettings
          enabled={settings.focusLock}
          onToggle={(v) => onSettingsChange({ ...settings, focusLock: v })}
        />

        <RoutineEditor
          routines={settings.routines}
          onChange={(routines) => onSettingsChange({ ...settings, routines })}
        />
      </div>
    </div>
  )
}

// 專注鎖設定（僅原生 iOS 顯示）：開關 + 選要鎖哪些 App
function FocusLockSettings({
  enabled,
  onToggle,
}: {
  enabled: boolean
  onToggle: (v: boolean) => void
}) {
  const [supported, setSupported] = useState(false)
  const [authorized, setAuthorized] = useState(false)
  const [hasSel, setHasSel] = useState(false)
  const [picked, setPicked] = useState<number | null>(null)

  useEffect(() => {
    if (!focusLock.available()) return
    focusLock.getState().then((s) => {
      setSupported(s.supported)
      setAuthorized(s.authorized)
      setHasSel(s.hasSelection)
    })
  }, [])

  // 只有原生外掛確實回報支援才顯示（web/PWA、未含外掛的 build 一律隱藏）
  if (!supported) return null

  const turnOn = async () => {
    const ok = authorized || (await focusLock.requestAuthorization())
    setAuthorized(ok)
    if (ok) {
      onToggle(true)
      if (!hasSel) await pick()
    }
  }

  const pick = async () => {
    const n = await focusLock.pickApps()
    setPicked(n)
    setHasSel(n > 0)
  }

  const pickLabel =
    picked && picked > 0 ? `已選 ${picked} 個・重選` : hasSel ? '重選要鎖的 App' : '選擇要鎖的 App'

  return (
    <div className="settings-row focuslock-row">
      <span>專注時鎖住分心 App</span>
      <button
        className={`fl-toggle ${enabled ? 'on' : ''}`}
        onClick={() => (enabled ? onToggle(false) : turnOn())}
      >
        {enabled ? '已開啟' : '開啟'}
      </button>
      {enabled && (
        <button className="fl-pick" onClick={pick}>
          {pickLabel}
        </button>
      )}
      {enabled && !hasSel && picked === null && (
        <span className="hint fl-hint">先選要鎖哪些 App</span>
      )}
    </div>
  )
}

// 時間軸快填 routine 編輯器（可自訂 emoji/名稱/時間/長度，最多 8 個）
const ROUTINE_DURS = [30, 60, 90, 120, 180, 240, 300, 360]
const toHHMM = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const fromHHMM = (s: string) => {
  const [h, mm] = s.split(':').map(Number)
  return (h || 0) * 60 + (mm || 0)
}
const durLabel = (d: number) => (d < 60 ? `${d} 分` : `${d / 60} 小時`)

function RoutineEditor({
  routines,
  onChange,
}: {
  routines: RoutineItem[]
  onChange: (r: RoutineItem[]) => void
}) {
  const set = (i: number, patch: Partial<RoutineItem>) =>
    onChange(routines.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const remove = (i: number) => onChange(routines.filter((_, j) => j !== i))
  const add = () =>
    onChange([...routines, { emoji: '⭐', label: '新項目', start: 9 * 60, dur: 60, color: 'gold' }])

  return (
    <div className="routine-editor">
      <div className="label">時間軸快填 routine（最多 {MAX_ROUTINES} 個・點時間軸上的鈕即帶入）</div>
      {routines.map((r, i) => (
        <div className="routine-card" key={i}>
          <div className="routine-line">
            <input
              className="re-emoji"
              value={r.emoji}
              maxLength={2}
              onChange={(e) => set(i, { emoji: e.target.value })}
            />
            <TextField
              className="re-label"
              value={r.label}
              placeholder="名稱"
              onValue={(v) => set(i, { label: v })}
            />
            <button className="re-del" onClick={() => remove(i)} title="刪除">
              ✕
            </button>
          </div>
          <div className="routine-line">
            <input
              className="re-time"
              type="time"
              step={1800}
              value={toHHMM(r.start)}
              onChange={(e) => set(i, { start: fromHHMM(e.target.value) })}
            />
            <select
              className="re-dur"
              value={r.dur}
              onChange={(e) => set(i, { dur: Number(e.target.value) })}
            >
              {ROUTINE_DURS.map((d) => (
                <option key={d} value={d}>
                  {durLabel(d)}
                </option>
              ))}
            </select>
            <div className="re-swatches">
              {ROUTINE_COLORS.map((c) => (
                <button
                  key={c.key}
                  className={`tl-swatch ${r.color === c.key ? 'on' : ''}`}
                  style={{ background: c.hex }}
                  onClick={() => set(i, { color: c.key })}
                  title={c.key}
                />
              ))}
            </div>
          </div>
        </div>
      ))}
      {routines.length < MAX_ROUTINES && (
        <button className="re-add" onClick={add}>
          ＋ 新增 routine
        </button>
      )}
    </div>
  )
}
