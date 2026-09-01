import { useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import {
  activateWithCode,
  cloudEnabled,
  currentEmail,
  deleteAccount,
  signInOrUp,
  signOut,
  startAutoSync,
  stopAutoSync,
  syncNow,
  currentUserId,
} from './cloud'
import { TextArea, TextField } from './fields'
import { focusLock } from './focusLock'
import IapPanel from './IapPanel'
import { notify } from './notify'
import { PlantLegend } from './plantGlyphs'
import {
  BackupMeta,
  clearAllLocalData,
  clearSupabaseTokens,
  daysSinceExport,
  discardLocalForNewOwner,
  exportBackupAsFile,
  localDataCount,
  setDataOwner,
  importAll,
  listBackups,
  markExported,
  restoreBackup,
} from './storage'
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
                          想跨裝置用同一份資料？<b>買過的人</b>：序號欄留空，Email 直接填<b>購買時填的那個</b>，
                          再設一組你自己的密碼就開通。<b>朋友</b>：填我給你的邀請碼。
                          換裝置用這組 Email＋密碼登入即可。本機與全部功能<b>永久免費</b>。
                        </p>
                        <div className="label" style={{ marginTop: 6 }}>邀請碼或購買序號（買過的人免填）</div>
                        <div className="line-input sync-token">
                          <input
                            placeholder="有邀請碼才填，買過的人留空"
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
                                if (!cloudEmail.includes('@')) throw new Error('請填你的 Email')
                                if (cloudPw.length < 8) throw new Error('密碼至少 8 碼')
                                const mode = await activateWithCode(license, cloudEmail, cloudPw)
                                setCloudUser(cloudEmail)
                                setCloudStage('in')
                                const r = await syncAfterLogin(cloudEmail)
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
                                const r = await syncAfterLogin(cloudEmail)
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
                    <div className="data-actions" style={{ marginTop: 14 }}>
                      <button
                        className="link-btn"
                        style={{ color: 'var(--terra)' }}
                        onClick={() => {
                          const typed = prompt(
                            '永久刪除帳號會刪掉雲端與這台裝置上的所有資料，無法復原。\n\n若確定，請輸入你的 Email 以確認刪除：'
                          )
                          if (typed == null) return
                          if (typed.trim().toLowerCase() !== (cloudUser ?? '').toLowerCase()) {
                            alert('Email 不符，已取消刪除。')
                            return
                          }
                          cloudAct(async () => {
                            await deleteAccount()
                            stopAutoSync()
                            clearAllLocalData()
                            location.reload()
                          })
                        }}
                      >
                        永久刪除帳號
                      </button>
                    </div>
                  </>
                )}
                {cloudMsg && <p className="sync-status">{cloudMsg}</p>}
              </div>
              {/* iOS 內購：買斷雲端同步（web / 未設定 RevenueCat / 已登入時自動隱藏） */}
              <IapPanel signedIn={cloudStage === 'in'} />
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

          <div className="settings-row focuslock-row">
            <span>專注風格</span>
            <button
              className={`fl-toggle ${settings.focusStyle === 'tree' ? 'on' : ''}`}
              onClick={() =>
                onSettingsChange({ ...settings, focusStyle: settings.focusStyle === 'tree' ? 'grid' : 'tree' })
              }
            >
              {settings.focusStyle === 'tree' ? '🌱 種樹' : '▦ 方格'}
            </button>
            <span className="hint fl-hint">點按鈕切換兩種塗格風格：🌱 <b>種樹</b>＝完成一段專注長出樹（越久越厲害、放棄會枯萎）；▦ <b>方格</b>＝純粹稿紙塗圈、極簡不遊戲化。</span>
          </div>

          {settings.focusStyle === 'tree' && <PlantLegend />}

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

          <BackupSettings />

          {!isNative && (
            <p className="sync-help" style={{ marginTop: 20, textAlign: 'center' }}>
              <a href="landing.html" target="_blank" rel="noreferrer">官網介紹</a>
              {' ・ '}
              <a href="manual.html" target="_blank" rel="noreferrer">使用手冊</a>
              {' ・ '}
              <a href="https://qqleveragelife.substack.com" target="_blank" rel="noreferrer">第二大腦週報</a>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// 登入後的第一次同步。這裡是共用裝置外洩的風險點：
// 這台裝置上可能有「上一個人」留下的本機日記，直接同步會把它整包推進現在登入者的帳號。
// 所以第一次同步先拒絕認領，改成問人；背景自動同步不受影響（那是既有 session）。
async function syncAfterLogin(email: string): Promise<{ pulled: number; pushed: number }> {
  try {
    return await syncNow({ onUnclaimed: 'reject' })
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (msg !== 'device-unclaimed-data' && msg !== 'device-owner-mismatch') throw e

    const uid = await currentUserId()
    if (!uid) throw e
    const n = localDataCount()
    const mine =
      msg === 'device-owner-mismatch'
        ? `這台裝置上的 ${n} 筆記錄屬於「另一個帳號」。`
        : `這台裝置上有 ${n} 筆還沒同步過的本機記錄。`
    const merge = confirm(
      `${mine}\n\n要把它們合併進 ${email} 這個帳號嗎？\n\n` +
        `「確定」＝合併並上傳到這個帳號。\n` +
        `「取消」＝不上傳，改用這個帳號雲端上的資料（本機這份會先自動備份，可在下方「資料備份」還原）。\n\n` +
        `如果這台裝置是跟別人共用的，請選「取消」——否則對方的記錄會進到你的帳號。`
    )
    if (merge) setDataOwner(uid)
    else discardLocalForNewOwner(uid)
    return await syncNow()
  }
}

// 資料備份/還原：列出本機每日快照，可一鍵還原、可存成檔案帶離這台裝置（安全網）
function BackupSettings() {
  const [items, setItems] = useState<BackupMeta[]>(() => listBackups())
  const [msg, setMsg] = useState('')
  const [stale, setStale] = useState<number | null>(() => daysSinceExport())
  const fileRef = useRef<HTMLInputElement>(null)

  // 把備份帶離這台裝置。網頁用下載；iOS 原生 WKWebView 的 <a download> 常常
  // 靜默失敗，那種「按了說成功、其實什麼都沒存」比不給按更糟——
  // 所以原生一律走剪貼簿，並如實告訴使用者東西在哪。
  const takeOffDevice = async (date: string) => {
    let text: string
    try {
      text = exportBackupAsFile(date)
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : '匯出失敗'}`)
      return
    }
    if (Capacitor.isNativePlatform()) {
      try {
        await navigator.clipboard.writeText(text)
        markExported()
        setStale(daysSinceExport())
        setMsg(`✓ ${date} 的備份已複製到剪貼簿（${Math.round(text.length / 1024)}KB）——貼到備忘錄或 Email 給自己存著`)
      } catch {
        setMsg('✗ 複製失敗——請改用網頁版 yikeday.com 下載備份檔')
      }
      return
    }
    try {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
      a.download = `yike-backup-${date}.json`
      a.click()
      URL.revokeObjectURL(a.href)
      markExported()
      setStale(daysSinceExport())
      setMsg(`✓ 已下載 yike-backup-${date}.json——存到雲端硬碟或寄給自己，別只放在這台`)
    } catch {
      setMsg('✗ 下載失敗，請換個瀏覽器再試')
    }
  }

  return (
    <div className="data-actions backup-box" style={{ marginTop: 18, display: 'block' }}>
      <div className="label">資料備份（本機自動，每天一份，留最近 7 份）</div>
      <p className="sync-help">
        同步出錯或資料被清掉時的安全網。這些備份<b>只存在這台裝置</b>——
        清瀏覽器資料、換手機、系統清理儲存空間，備份會跟資料一起消失。
        真的重要的話，用「存成檔案」把它帶離這台裝置。
      </p>
      {stale === null && items.length > 0 && (
        <p className="hint" style={{ marginTop: 6 }}>
          ⚠️ 你還沒把任何備份存出去過。備份跟資料放在同一個地方，不算備份。
        </p>
      )}
      {stale !== null && stale >= 30 && (
        <p className="hint" style={{ marginTop: 6 }}>
          ⚠️ 距離上次存出備份已經 {stale} 天了。
        </p>
      )}
      {items.length === 0 ? (
        <p className="hint" style={{ marginTop: 8 }}>
          還沒有備份——有資料時開站會自動建立第一份。
        </p>
      ) : (
        <ul className="backup-list">
          {items.map((b) => (
            <li key={b.date}>
              <span>
                {b.date} · {b.keys} 筆 · {Math.max(1, Math.round(b.bytes / 1024))}KB
              </span>
              <button
                className="link-btn"
                onClick={() => {
                  if (
                    !confirm(
                      `用 ${b.date} 的備份覆蓋目前這台的資料？\n\n目前資料會被該備份取代（若有雲端帳號，還原後會自動上傳同步）。`
                    )
                  )
                    return
                  const n = restoreBackup(b.date)
                  setItems(listBackups())
                  setMsg(`✓ 已還原 ${n} 筆（${b.date}），即將重新整理…`)
                  setTimeout(() => location.reload(), 900)
                }}
              >
                還原
              </button>
              <button className="link-btn" onClick={() => void takeOffDevice(b.date)}>
                存成檔案
              </button>
            </li>
          ))}
        </ul>
      )}
      <div style={{ marginTop: 10 }}>
        <button
          className="link-btn"
          onClick={() => fileRef.current?.click()}
        >
          從備份檔還原
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = '' // 允許連選同一個檔
            if (!f) return
            void f.text().then((txt) => {
              try {
                const n = importAll(txt)
                setMsg(`✓ 已從檔案還原 ${n} 筆，即將重新整理…`)
                setTimeout(() => location.reload(), 900)
              } catch (err) {
                setMsg(`✗ 這個檔看起來不是一刻的備份：${err instanceof Error ? err.message : ''}`)
              }
            })
          }}
        />
      </div>
      {msg && (
        <p className="hint" style={{ marginTop: 6 }}>
          {msg}
        </p>
      )}
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
