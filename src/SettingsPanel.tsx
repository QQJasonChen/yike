import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import {
  activateWithCode,
  cloudEnabled,
  currentEmail,
  signInOrUp,
  signOut,
  startAutoSync,
  stopAutoSync,
  syncNow,
} from './cloud'
import { TextArea, TextField } from './fields'
import { focusLock } from './focusLock'
import { notify } from './notify'
import { clearAllLocalData, clearSupabaseTokens } from './storage'
import {
  DEFAULT_EVENING_QS,
  DEFAULT_MORNING_QS,
  MAX_ROUTINES,
  ROUTINE_COLORS,
  RoutineItem,
  Settings,
} from './types'

// Graham Weaver 晨間三問（QQ 的每日框架）
const WEAVER_MORNING_QS = [
  '寫下 3 件能推進主線的事',
  '今天的目標宣言（現在式）：「我是＿＿」',
  '我今天在玩什麼 different game？',
]

interface Props {
  settings: Settings
  onSettingsChange: (s: Settings) => void
  onClose: () => void
}

export default function SettingsPanel({ settings, onSettingsChange, onClose }: Props) {
  // ---- 自訂每日問題 ----
  const [showQEditor, setShowQEditor] = useState(false)
  const [mDraft, setMDraft] = useState(() => settings.morningQs.join('\n'))
  const [eDraft, setEDraft] = useState(() => settings.eveningQs.join('\n'))

  const saveQs = (m: string, e: string) =>
    onSettingsChange({
      ...settings,
      morningQs: m.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 6),
      eveningQs: e.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 6),
    })

  // ---- 帳號制雲端同步（Supabase）----
  const [cloudEmail, setCloudEmail] = useState('')
  const [cloudPw, setCloudPw] = useState('')
  const [license, setLicense] = useState('')
  // iOS App Store 合規：原生版不得提及外部購買（Gumroad）。原生 → 只走登入；網頁 → 完整購買/序號流程。
  const isNative = Capacitor.isNativePlatform()
  const [authMode, setAuthMode] = useState<'activate' | 'login'>(isNative ? 'login' : 'activate')
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

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <span className="settings-title">設定</span>
          <button className="settings-close" onClick={onClose} title="關閉">
            ✕
          </button>
        </div>

        <div className="settings-body">
          {cloudEnabled() && (
            <>
              <div className="label" style={{ justifyContent: 'center' }}>
                雲端同步（帳號制）
              </div>
              <div className="sync-box">
                {cloudStage === 'out' && (
                  <>
                    {!isNative && authMode === 'activate' ? (
                      <>
                        <p className="sync-help">
                          想跨裝置用同一份資料？<b>輸入邀請碼</b>（朋友跟我拿），再設一組<b>你自己的</b> Email＋密碼就開通——
                          換裝置用這組登入即可。本機與全部功能<b>永久免費</b>。
                        </p>
                        <div className="label" style={{ marginTop: 6 }}>邀請碼或購買序號</div>
                        <div className="line-input sync-token">
                          <input
                            placeholder="邀請碼或購買序號"
                            value={license}
                            onChange={(e) => setLicense(e.target.value.trim())}
                          />
                        </div>
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
                            placeholder="自設密碼（至少 8 碼，請記好）"
                            value={cloudPw}
                            onChange={(e) => setCloudPw(e.target.value)}
                          />
                        </div>
                        <div className="data-actions" style={{ marginTop: 12 }}>
                          <button
                            onClick={() =>
                              cloudAct(async () => {
                                if (license.trim().length < 2) throw new Error('請先填邀請碼或購買序號')
                                if (!cloudEmail.includes('@')) throw new Error('請填你的 Email')
                                if (cloudPw.length < 8) throw new Error('密碼至少 8 碼')
                                const mode = await activateWithCode(license, cloudEmail, cloudPw)
                                setCloudUser(cloudEmail)
                                setCloudStage('in')
                                const r = await syncNow()
                                await startAutoSync()
                                setCloudMsg(
                                  `✓ ${mode === 'up' ? '開通成功' : '登入成功'}，已同步（↓${r.pulled} ↑${r.pushed}）`
                                )
                                if (r.pulled > 0) setTimeout(() => location.reload(), 1000)
                              })
                            }
                          >
                            開通並登入
                          </button>
                          <button className="link-btn" onClick={() => setAuthMode('login')}>
                            已經有帳號？直接登入
                          </button>
                        </div>
                        <a
                          className="buy-cta"
                          style={{ marginTop: 14 }}
                          href="https://qqleverage.gumroad.com/l/Yike?layout=profile"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          ☁️ 支持，前往 Gumroad
                        </a>
                      </>
                    ) : (
                      <>
                        <p className="sync-help">
                          用你的 <b>Email ＋ 密碼</b> 登入，所有裝置自動同步——寫完即上雲、換裝置打開就有。
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
                            placeholder="密碼"
                            value={cloudPw}
                            onChange={(e) => setCloudPw(e.target.value)}
                          />
                        </div>
                        <div className="data-actions" style={{ marginTop: 12 }}>
                          <button
                            disabled={!cloudEmail.includes('@') || cloudPw.length < 8}
                            onClick={() =>
                              cloudAct(async () => {
                                const mode = await signInOrUp(cloudEmail, cloudPw)
                                setCloudUser(cloudEmail)
                                setCloudStage('in')
                                const r = await syncNow()
                                await startAutoSync()
                                setCloudMsg(
                                  `✓ ${mode === 'up' ? '開通成功' : '登入成功'}，已同步（↓${r.pulled} ↑${r.pushed}）`
                                )
                                if (r.pulled > 0) setTimeout(() => location.reload(), 1000)
                              })
                            }
                          >
                            登入
                          </button>
                          {!isNative && (
                            <button className="link-btn" onClick={() => setAuthMode('activate')}>
                              ← 還沒帳號？用序號開通
                            </button>
                          )}
                        </div>
                      </>
                    )}
                    <div className="data-actions" style={{ marginTop: 16 }}>
                      <button
                        className="link-btn"
                        onClick={() => {
                          if (
                            !confirm(
                              '清空「這台裝置」上的所有本機資料、回到全空白？\n\n若你有雲端帳號，資料都在雲端、登入即可還原；純本機未同步的資料會永久消失。'
                            )
                          )
                            return
                          clearSupabaseTokens()
                          clearAllLocalData()
                          location.reload()
                        }}
                      >
                        這台不是你的、或想清空回空白？
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
                        onClick={() => {
                          if (
                            !confirm(
                              '登出會清除這台裝置上的本機資料，回到空白頁面。\n\n你的資料都在雲端帳號裡，重新登入（這台或任何裝置）就會完整還原。確定登出？'
                            )
                          )
                            return
                          cloudAct(async () => {
                            // 先把未同步的推上雲，連不上就中止以免遺失
                            try {
                              await syncNow()
                            } catch {
                              throw new Error('目前連不上雲端，為避免資料遺失，請連網後再登出')
                            }
                            await signOut()
                            stopAutoSync()
                            clearAllLocalData()
                            location.reload() // 回到全空白狀態
                          })
                        }}
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
            <span>連續番茄鐘</span>
            <button
              className={`fl-toggle ${settings.autoLoop ? 'on' : ''}`}
              onClick={() => onSettingsChange({ ...settings, autoLoop: !settings.autoLoop })}
            >
              {settings.autoLoop ? '開啟' : '關閉'}
            </button>
            <span className="hint fl-hint">休息結束自動接下一段專注，不用回 app 按開始</span>
          </div>

          <ReminderSettings settings={settings} onChange={onSettingsChange} />

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

          <div className="data-actions" style={{ marginTop: 18 }}>
            <button onClick={() => setShowQEditor((v) => !v)}>✎ 自訂每日問題</button>
          </div>
          {showQEditor && (
            <div className="sync-box" style={{ marginTop: 10 }}>
              <p className="sync-help">
                一行一個問題，存了之後「今天」頁立即生效。把一刻手帳變成<b>你的</b>方法。
              </p>
              <div className="label" style={{ marginTop: 10 }}>晨間問題</div>
              <TextArea className="line-area" rows={4} value={mDraft} onValue={setMDraft} />
              <div className="label">晚間問題</div>
              <TextArea className="line-area" rows={4} value={eDraft} onValue={setEDraft} />
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
        </div>
      </div>
    </div>
  )
}

// 每日提醒設定（僅原生 iOS 顯示）：開關 + 時間
function ReminderSettings({
  settings,
  onChange,
}: {
  settings: Settings
  onChange: (s: Settings) => void
}) {
  if (!notify.available()) return null
  const toggle = async () => {
    if (settings.reminderEnabled) {
      await notify.setDailyReminder(false, settings.reminderTime)
      onChange({ ...settings, reminderEnabled: false })
    } else {
      const ok = await notify.setDailyReminder(true, settings.reminderTime)
      if (ok) onChange({ ...settings, reminderEnabled: true })
      else alert('需要通知權限——請到 iOS 設定 → 一刻手帳 → 通知 開啟後再試。')
    }
  }
  const changeTime = async (t: string) => {
    onChange({ ...settings, reminderTime: t })
    if (settings.reminderEnabled) await notify.setDailyReminder(true, t)
  }
  return (
    <div className="settings-row focuslock-row">
      <span>每日提醒</span>
      <button
        className={`fl-toggle ${settings.reminderEnabled ? 'on' : ''}`}
        onClick={toggle}
      >
        {settings.reminderEnabled ? '開啟' : '關閉'}
      </button>
      {settings.reminderEnabled && (
        <input
          type="time"
          className="reminder-time"
          value={settings.reminderTime}
          onChange={(e) => changeTime(e.target.value)}
        />
      )}
      <span className="hint fl-hint">每天這個時間，提醒你寫下今天最重要的任務</span>
    </div>
  )
}

// 專注鎖設定（僅原生 iOS 顯示）：開關 + 選要鎖哪些 App
function FocusLockSettings({ enabled, onToggle }: { enabled: boolean; onToggle: (v: boolean) => void }) {
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
      <button className={`fl-toggle ${enabled ? 'on' : ''}`} onClick={() => (enabled ? onToggle(false) : turnOn())}>
        {enabled ? '已開啟' : '開啟'}
      </button>
      {enabled && (
        <button className="fl-pick" onClick={pick}>
          {pickLabel}
        </button>
      )}
      {enabled && !hasSel && picked === null && <span className="hint fl-hint">先選要鎖哪些 App</span>}
    </div>
  )
}

// 時間軸快填 routine 編輯器（可自訂 emoji/名稱/時間/長度/顏色，最多 8 個）
const ROUTINE_DURS = [30, 60, 90, 120, 180, 240, 300, 360, 420, 480, 540, 600]
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
            <select className="re-dur" value={r.dur} onChange={(e) => set(i, { dur: Number(e.target.value) })}>
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
