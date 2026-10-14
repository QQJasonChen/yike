import { useEffect, useRef, useState } from 'react'
import { clearUnsavedDrafts, hasUnsavedDrafts } from './useStoredEntry'
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
  syncStatusMessage,
  type SyncResult,
  currentUserId,
} from './cloud'
import { OPENAI_KEY_HELP_URL, verifyKeyAndPickModel } from './ai'
import { TextArea, TextField } from './fields'
import { focusLock } from './focusLock'
import IapPanel from './IapPanel'
import { notify } from './notify'
import { PlantLegend } from './plantGlyphs'
import {
  BackupMeta,
  allDataKeys,
  clearAllLocalData,
  clearSupabaseTokens,
  daysSinceExport,
  discardLocalForNewOwner,
  exportBackupAsFile,
  getOpenAIKey,
  localDataCount,
  claimDeviceFor,
  clearForLogout,
  getDataOwner,
  inspectImport,
  loadDirty,
  pendingGatedKeys,
  listConflicts,
  exportConflictAsFile,
  dismissConflict,
  importAll,
  listBackups,
  markExported,
  restoreBackup,
  setOpenAIKey,
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
                          已購買雲端同步？從 Gumroad 購買完成頁或購買信的「開通教學與購買序號」（或「檢視內容」）複製<b>購買序號（License Key）</b>，
                          貼在下方，再填<b>購買時使用的 Email</b>、自設<b>至少 8 碼密碼</b>，按「開通並登入」。
                          換裝置時，用同一組 Email＋密碼登入。本機使用<b>永久免費</b>。
                        </p>
                        <div className="label" style={{ marginTop: 6 }}>購買序號（License Key，必填）</div>
                        <div className="line-input sync-token">
                          <input
                            aria-label="購買序號（License Key，必填）"
                            autoComplete="off"
                            placeholder="貼上 Gumroad 購買內容裡的序號"
                            value={license}
                            onChange={(e) => setLicense(e.target.value.trim())}
                          />
                        </div>
                        <div className="label" style={{ marginTop: 6 }}>購買時使用的 Email</div>
                        <div className="line-input sync-token">
                          <input
                            type="email"
                            autoComplete="email"
                            aria-label="購買時使用的 Email"
                            placeholder="需與 Gumroad 購買確認信一致"
                            value={cloudEmail}
                            onChange={(e) => setCloudEmail(e.target.value.trim())}
                          />
                        </div>
                        <div className="line-input sync-token">
                          <input
                            type="password"
                            autoComplete="new-password"
                            aria-label="自設密碼（至少 8 碼）"
                            placeholder="自設密碼（至少 8 碼，請記好）"
                            value={cloudPw}
                            onChange={(e) => setCloudPw(e.target.value)}
                          />
                        </div>
                        <div className="data-actions" style={{ marginTop: 12 }}>
                          <button
                            disabled={!license.trim() || !cloudEmail.includes('@') || cloudPw.length < 8}
                            onClick={() =>
                              cloudAct(async () => {
                                if (!license.trim()) throw new Error('請填入購買序號（License Key）')
                                if (!cloudEmail.includes('@')) throw new Error('請填購買時使用的 Email')
                                if (cloudPw.length < 8) throw new Error('密碼至少 8 碼')
                                if (hasUnsavedDrafts()) throw new Error('請先複製並保存畫面上尚未儲存的草稿，再開通帳號')
                                const mode = await activateWithCode(license, cloudEmail, cloudPw)
                                setCloudUser(cloudEmail)
                                setCloudStage('in')
                                const r = await syncAfterLogin(cloudEmail)
                                window.dispatchEvent(new CustomEvent('yike:local-owner-ready', { detail: { owner: getDataOwner() } }))
                                window.dispatchEvent(new Event('yike:backup-change'))
                                await startSyncReporting()
                                setCloudMsg(
                                  `✓ ${mode === 'up' ? '開通成功' : '登入成功'}，${syncStatusMessage(r)}`
                                )
                              })
                            }
                          >
                            開通並登入
                          </button>
                          <button className="link-btn" onClick={() => setAuthMode('login')}>
                            已經有帳號？直接登入
                          </button>
                        </div>
                        <details style={{ marginTop: 12 }}>
                          <summary style={{ cursor: 'pointer' }}>找不到購買序號？</summary>
                          <p className="sync-help">
                            請來信 qqleveragelearning@gmail.com，附購買確認信，請客服協助取得序號；不必重新付款，也不用提供密碼。
                          </p>
                        </details>
                        <p className="sync-help" style={{ marginTop: 12 }}>
                          <a href="/activate.html" target="_blank" rel="noopener noreferrer">查看雲端同步開通圖解</a>
                        </p>
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
                                if (hasUnsavedDrafts()) throw new Error('請先複製並保存畫面上尚未儲存的草稿，再登入')
                                const mode = await signInOrUp(cloudEmail, cloudPw)
                                setCloudUser(cloudEmail)
                                setCloudStage('in')
                                const r = await syncAfterLogin(cloudEmail)
                                window.dispatchEvent(new CustomEvent('yike:local-owner-ready', { detail: { owner: getDataOwner() } }))
                                window.dispatchEvent(new Event('yike:backup-change'))
                                await startSyncReporting()
                                setCloudMsg(
                                  `✓ ${mode === 'up' ? '開通成功' : '登入成功'}，${syncStatusMessage(r)}`
                                )
                              })
                            }
                          >
                            登入
                          </button>
                          <a
                            className="link-btn"
                            href={isNative ? 'https://yikeday.com/recover.html' : '/recover.html'}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            忘記密碼？
                          </a>
                          {!isNative && (
                            <button className="link-btn" onClick={() => setAuthMode('activate')}>
                              ← 還沒帳號？啟用雲端同步
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
                          clearUnsavedDrafts(); clearAllLocalData()
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
                      ✓ 已登入 <b>{cloudUser}</b>——寫入後會自動嘗試同步；請以狀態訊息確認是否已上傳。其他裝置打開時會嘗試拉取。
                    </p>
                    <div className="data-actions" style={{ marginTop: 12 }}>
                      <button
                        onClick={() =>
                          cloudAct(async () => {
                            const r = await syncNow()
                            setCloudMsg(syncStatusMessage(r))
                            window.dispatchEvent(new Event('yike:backup-change'))
                          })
                        }
                      >
                        ⟳ 立即同步
                      </button>
                      <button
                        onClick={() => {
                          if (
                            !confirm(
                              '登出前會確認待推記錄已上傳；尚未儲存或未被雲端接受時會中止。\n\n登出會清除現用資料與憑證，保留此帳號的本機備份與衝突副本；備份仍可能隨瀏覽器資料清除而消失。確定登出？'
                            )
                          )
                            return
                          cloudAct(async () => {
                            // 先把未同步的推上雲，連不上就中止以免遺失
                            try {
                              if (hasUnsavedDrafts()) throw new Error('unsaved-draft')
                              const result = await syncNow()
                              if (result.held || result.rejected || Object.keys(loadDirty()).length || pendingGatedKeys().length)
                                throw new Error('pending-local-data')
                            } catch {
                              throw new Error('仍有未儲存或未上傳的記錄，已取消登出；請先保存草稿、匯出備份或稍後重試同步')
                            }
                            await signOut()
                            stopAutoSync()
                            clearForLogout()
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
                            '永久刪除會移除帳號、目前雲端記錄與這台裝置資料，無法用原帳號登入。歷史加密備份、其他裝置與你另存的檔案不會因此立刻消失。\n\n若確定，請輸入你的 Email 以確認刪除：'
                          )
                          if (typed == null) return
                          if (typed.trim().toLowerCase() !== (cloudUser ?? '').toLowerCase()) {
                            alert('Email 不符，已取消刪除。')
                            return
                          }
                          cloudAct(async () => {
                            await deleteAccount()
                            stopAutoSync()
                            clearUnsavedDrafts(); clearAllLocalData()
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
          <OpenAIKeySettings />

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

// AI 金鑰設定：使用者填自己的 OpenAI 金鑰，站方完全不碰。
function OpenAIKeySettings() {
  const [key, setKey] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const saved = getOpenAIKey()
  const masked = saved ? `${saved.slice(0, 7)}…${saved.slice(-4)}` : ''
  return (
    <div className="data-actions backup-box" style={{ marginTop: 18, display: 'block' }}>
      <div className="label">AI 教練（選用，需要你自己的 OpenAI 金鑰）</div>
      <p className="sync-help">
        填入金鑰後，「回顧」頁會多一個 AI 分析按鈕，幫你從記錄裡看出模式。
        <b>金鑰只存在這台裝置</b>——不會同步上雲、不進備份、不經過我的伺服器；
        你的日記是從你的瀏覽器直接送到 OpenAI 的。費用走你自己的 OpenAI 帳戶，用多少付多少。
      </p>
      <ol className="sync-help" style={{ paddingLeft: 20, marginTop: 8 }}>
        <li>
          到{' '}
          <a href={OPENAI_KEY_HELP_URL} target="_blank" rel="noopener noreferrer">
            platform.openai.com/api-keys
          </a>{' '}
          登入（沒帳號就先註冊）
        </li>
        <li>按 <b>Create new secret key</b>，取個名字如「一刻手帳」，建立</li>
        <li>複製那串 <code>sk-</code> 開頭的字（<b>只會顯示這一次</b>），貼到下面</li>
        <li>
          OpenAI 需要先儲值才能用（最低 US$5）。建議到{' '}
          <a
            href="https://platform.openai.com/settings/organization/limits"
            target="_blank"
            rel="noopener noreferrer"
          >
            Limits
          </a>{' '}
          設一個每月上限，以防萬一
        </li>
      </ol>
      <p className="hint" style={{ marginTop: 6 }}>
        一次分析大約 US$0.001（約新台幣三分錢）。儲值 US$5 大概夠用好幾年。
      </p>
      <div className="line-input sync-token" style={{ marginTop: 8 }}>
        <input
          type="password"
          placeholder={masked || 'sk-...'}
          value={key}
          onChange={(e) => setKey(e.target.value.trim())}
        />
      </div>
      <div className="data-actions" style={{ marginTop: 8 }}>
        <button
          disabled={busy}
          onClick={() => {
            const v = key.trim()
            if (!v) {
              setOpenAIKey('')
              setMsg('✓ 已清除金鑰，AI 功能關閉')
              return
            }
            if (!v.startsWith('sk-')) {
              setMsg('✗ OpenAI 金鑰應該是 sk- 開頭，再確認一次有沒有複製完整')
              return
            }
            setBusy(true)
            setMsg('驗證中…')
            void verifyKeyAndPickModel(v).then((r) => {
              setBusy(false)
              if (!r.ok) {
                setMsg(`✗ ${r.error}`)
                return
              }
              // 存之前就驗過，不會出現「顯示已儲存、實際上根本不能用」
              setOpenAIKey(v, r.model)
              setKey('')
              setMsg(`✓ 金鑰有效，已儲存（將使用 ${r.model}）。回顧頁的 AI 分析可以用了`)
            })
          }}
        >
          {busy ? '驗證中…' : key.trim() ? '驗證並儲存' : saved ? '清除金鑰' : '儲存金鑰'}
        </button>
      </div>
      {saved && !msg && (
        <p className="hint" style={{ marginTop: 6 }}>
          目前已設定：{masked}
        </p>
      )}
      {msg && (
        <p className="hint" style={{ marginTop: 6 }}>
          {msg}
        </p>
      )}
    </div>
  )
}

const startSyncReporting = () => startAutoSync((message) => {
  window.dispatchEvent(new CustomEvent('yike:sync-status', { detail: { message } }))
  window.dispatchEvent(new Event('yike:backup-change'))
})

// Restore/import are synchronous merges. Refresh mounted views directly, without a
// delayed page reload which could discard a draft created during the delay.
const refreshRestoredViews = () => {
  for (const key of allDataKeys())
    window.dispatchEvent(new CustomEvent('yike:external-key-change', { detail: { key } }))
  window.dispatchEvent(new Event('yike:backup-change'))
}

// 登入後的第一次同步。這裡是共用裝置外洩的風險點：
// 這台裝置上可能有「上一個人」留下的本機日記，直接同步會把它整包推進現在登入者的帳號。
// 所以第一次同步先拒絕認領，改成問人；背景自動同步不受影響（那是既有 session）。
async function syncAfterLogin(email: string): Promise<SyncResult> {
  try {
    return await syncNow({ onUnclaimed: 'reject' })
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (msg !== 'device-unclaimed-data' && msg !== 'device-owner-mismatch') throw e

    const uid = await currentUserId()
    if (!uid) throw e
    const beforeOwner = getDataOwner()
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
    if (await currentUserId() !== uid || getDataOwner() !== beforeOwner) throw new Error('帳號已變更，請重新登入確認')
    if (merge) claimDeviceFor(uid)
    else discardLocalForNewOwner(uid)
    return await syncNow()
  }
}

// 資料備份/還原：列出本機每日快照，可一鍵還原、可存成檔案帶離這台裝置（安全網）
function BackupSettings() {
  const [items, setItems] = useState<BackupMeta[]>(() => listBackups())
  const [conflicts, setConflicts] = useState(() => listConflicts())
  const owner = useRef(getDataOwner())
  useEffect(() => {
    const refresh = () => { setItems(listBackups()); setConflicts(listConflicts()) }
    const ready = (event: Event) => {
      const next = (event as CustomEvent<{ owner: string | null }>).detail?.owner
      if (next === undefined || next !== getDataOwner()) return
      owner.current = next
      refresh()
    }
    window.addEventListener('yike:backup-change', refresh)
    window.addEventListener('yike:local-owner-ready', ready)
    return () => {
      window.removeEventListener('yike:backup-change', refresh)
      window.removeEventListener('yike:local-owner-ready', ready)
    }
  }, [])
  const [msg, setMsg] = useState('')
  const [stale, setStale] = useState<number | null>(() => daysSinceExport())
  const fileRef = useRef<HTMLInputElement>(null)

  // 把備份帶離這台裝置。網頁用下載；iOS 原生 WKWebView 的 <a download> 常常
  // 靜默失敗，那種「按了說成功、其實什麼都沒存」比不給按更糟——
  // 所以原生一律走剪貼簿，並如實告訴使用者東西在哪。
  const takeOffDevice = async (id: string) => {
    const date = items.find((b) => b.id === id)?.date ?? id.split('#')[0]
    let text: string
    try {
      text = exportBackupAsFile(id)
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
      setMsg(`✓ 已開始下載 yike-backup-${date}.json——請確認已保存，並另存到自己的雲端硬碟`)
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
            <li key={b.id}>
              <span>
                {b.date}{b.pre ? '（還原前安全快照）' : ''} · {b.keys} 筆 · {Math.max(1, Math.round(b.bytes / 1024))}KB
              </span>
              <button
                className="link-btn"
                onClick={() => {
                  if (
                    !confirm(
                      `更新 ${b.date} 備份內的記錄？其他記錄保留，同名記錄會更新，之後會等待雲端同步。\n\n操作前會保存目前資料的安全快照；存不下就取消。`
                    )
                  )
                    return
                  try {
                    if (getDataOwner() !== owner.current) throw new Error('帳號已變更，請重新載入')
                    if (hasUnsavedDrafts()) throw new Error('請先複製並保存尚未儲存的草稿')
                    const n = restoreBackup(b.id)
                    setItems(listBackups()); setConflicts(listConflicts())
                    refreshRestoredViews()
                    setMsg(`✓ 已還原 ${n} 筆（${b.date}），畫面已更新；其他記錄保留`)
                  } catch (error) {
                    setMsg(`✗ 還原失敗：${error instanceof Error ? error.message : '請重試'}`)
                  }
                }}
              >
                還原
              </button>
              <button className="link-btn" onClick={() => void takeOffDevice(b.id)}>
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
                if (getDataOwner() !== owner.current) throw new Error('帳號已變更，請重新載入')
                if (hasUnsavedDrafts()) throw new Error('請先複製並保存尚未儲存的草稿')
                const preview = inspectImport(txt)
                const confirmed = !preview.requiresOwnerConfirmation || confirm(
                  `此檔來自另一帳號或未記錄帳號，含 ${preview.count} 筆。確認轉入目前登入帳號？同名記錄會更新，其他記錄保留，之後會同步到目前帳號。`
                )
                if (!confirmed) return
                if (inspectImport(txt).currentOwner !== preview.currentOwner) throw new Error('帳號已變更，請重新選擇備份檔')
                const n = importAll(txt, { confirmOwnerChange: preview.requiresOwnerConfirmation })
                refreshRestoredViews()
                setMsg(`✓ 已從檔案還原 ${n} 筆，畫面已更新；其他記錄保留`)
              } catch (err) {
                setMsg(`✗ 還原失敗：${err instanceof Error ? err.message : ''}`)
              }
            })
          }}
        />
      </div>
      {conflicts.length > 0 && <div>
        <div className="label">雲端衝突副本（{conflicts.length} 份）</div>
        <p className="sync-help">保留另一裝置的版本，尚未套回記錄。先存成檔案檢查，再決定是否匯入；匯入會更新同名記錄。</p>
        <ul className="backup-list">{conflicts.map((copy) => <li key={copy.id}>
          <span>{copy.key.replace(/^pp:/, '')} · {new Date(copy.at).toLocaleString()}</span>
          <button className="link-btn" onClick={() => void (async () => {
            try {
              const text = exportConflictAsFile(copy.id)
              if (Capacitor.isNativePlatform()) {
                await navigator.clipboard.writeText(text)
                setMsg('✓ 衝突副本已複製到剪貼簿，請貼到自己的備忘錄另存')
              } else {
                const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
                const a = document.createElement('a'); a.href = url; a.download = 'yike-conflict.json'; a.click(); URL.revokeObjectURL(url)
                setMsg('✓ 已開始下載衝突副本，請確認檔案已保存；尚未套回記錄')
              }
            } catch (error) { setMsg(`✗ ${error instanceof Error ? error.message : '副本匯出失敗'}`) }
          })()}>存成檔案</button>
          <button className="link-btn" onClick={() => {
            if (getDataOwner() !== owner.current) { setMsg('帳號已變更，請重新載入'); return }
            if (!confirm('刪除這份雲端副本？它可能是另一裝置版本的唯一一份。請先存成檔案。')) return
            dismissConflict(copy.id); setConflicts(listConflicts())
          }}>刪除副本</button>
        </li>)}</ul>
      </div>}
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
