// ⚙ 設定 →「Garmin／健康數據」：三種把 Garmin 接進一刻的方式，可以同時開。
//   ① Garmin 直連（官方 Health API，手錶一同步就自動進來；需登入一刻帳號）
//   ② Apple 健康（iOS app；Garmin Connect 開「Apple 健康」同步即可，零設定）
//   ③ 匯入 Garmin 匯出檔（所有平台；一次補齊多年歷史）
import { useEffect, useRef, useState } from 'react'
import { importHealthFiles } from './health'
import {
  appleHealth,
  appleHealthEnabled,
  appleHealthLastSync,
  appleHealthPlatform,
  setAppleHealthEnabled,
} from './healthKit'
import {
  GarminStatus,
  consumeGarminRedirect,
  garminConnect,
  garminStatus,
  garminUnlink,
  pullGarminHealth,
} from './garminCloud'
import { applyHealthRecords } from './healthSync'
import { cloudEnabled } from './cloudConfig'
import { allHealthKeys } from './storage'

const REDIRECT_MSG: Record<string, string> = {
  linked: '✓ Garmin 已連結！最近 30 天的資料會在幾分鐘內陸續送達',
  denied: '你在 Garmin 頁面選擇了不授權',
  expired: '連結逾時，請再按一次「連結 Garmin」',
  error: '✗ 連結失敗，請稍後再試',
}

export default function HealthSettings() {
  const [days, setDays] = useState(() => allHealthKeys().length)
  const refreshCount = () => setDays(allHealthKeys().length)

  // ---- ① Garmin 直連 ----
  const [gStatus, setGStatus] = useState<GarminStatus | null>(null)
  const [gMsg, setGMsg] = useState(() => {
    const r = consumeGarminRedirect()
    return r ? REDIRECT_MSG[r] ?? '' : ''
  })
  const [gBusy, setGBusy] = useState(false)
  useEffect(() => {
    if (!cloudEnabled()) return
    garminStatus()
      .then(setGStatus)
      .catch(() => setGStatus({ configured: true, linked: false, signedIn: true }))
  }, [])

  const gRun = async (fn: () => Promise<void>) => {
    setGBusy(true)
    try {
      await fn()
    } catch (e) {
      setGMsg(`✗ ${e instanceof Error ? e.message : '失敗'}`)
    } finally {
      setGBusy(false)
    }
  }

  const gPull = () =>
    gRun(async () => {
      const n = applyHealthRecords(await pullGarminHealth(90), 'garmin-api')
      setGMsg(n ? `✓ 更新了 ${n} 天` : '已是最新（Garmin 推送可能要等手錶下次同步）')
      refreshCount()
    })

  // ---- ② Apple 健康 ----
  const [ahAvail, setAhAvail] = useState(false)
  const [ahOn, setAhOn] = useState(appleHealthEnabled)
  const [ahMsg, setAhMsg] = useState('')
  useEffect(() => {
    appleHealth.available().then(setAhAvail)
  }, [])
  const ahSync = async (daysBack: number) => {
    setAhMsg('讀取中⋯')
    try {
      await appleHealth.authorize()
      setAppleHealthEnabled(true)
      setAhOn(true)
      const recs = await appleHealth.read(daysBack)
      const n = applyHealthRecords(recs, 'apple-health')
      setAhMsg(
        recs.length
          ? `✓ 讀到 ${recs.length} 天、更新 ${n} 天`
          : '沒讀到資料——請到 iPhone「設定 → 健康 → 資料存取與裝置 → 一刻手帳」把項目都打開，並確認 Garmin Connect 已開啟 Apple 健康同步'
      )
      refreshCount()
    } catch (e) {
      setAhMsg(`✗ ${e instanceof Error ? e.message : '失敗'}`)
    }
  }

  // ---- ③ 匯入檔案 ----
  const fileRef = useRef<HTMLInputElement>(null)
  const [fMsg, setFMsg] = useState('')
  const onFiles = async (list: FileList | null) => {
    if (!list?.length) return
    setFMsg('解析中⋯（大的匯出檔可能要十幾秒）')
    try {
      const res = await importHealthFiles([...list])
      if (!res.records.length) {
        setFMsg('✗ 沒找到每日健康資料。請選 Garmin 匯出的 zip，或裡面 DI_CONNECT 資料夾的 JSON 檔')
        return
      }
      const n = applyHealthRecords(res.records, 'garmin-file')
      const range = `${res.records[0].date} ～ ${res.records[res.records.length - 1].date}`
      setFMsg(`✓ 從 ${res.files} 個檔案讀到 ${res.records.length} 天（${range}），更新 ${n} 天`)
      refreshCount()
    } catch (e) {
      setFMsg(`✗ ${e instanceof Error ? e.message : '讀取失敗'}`)
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const last = appleHealthLastSync()

  return (
    <>
      <div className="label" style={{ justifyContent: 'center', marginTop: 18 }}>
        ⌚ Garmin／健康數據
      </div>
      <div className="sync-box">
        <p className="sync-help">
          把 Garmin 手錶的睡眠、身體能量、HRV、壓力、心率、步數接進來，「今天」頁會多一張<b>身體狀況</b>卡片，
          並依狀態建議今天該排多少專注。三種方式可以同時開，資料會自動合併
          {days > 0 && (
            <>
              （目前已有 <b>{days}</b> 天）
            </>
          )}
          。
        </p>

        {/* ① Garmin 直連 */}
        <div className="label" style={{ marginTop: 12 }}>① Garmin 帳號直連（自動）</div>
        {!cloudEnabled() || (gStatus && !gStatus.signedIn) ? (
          <p className="sync-help">需要先登入上方的一刻雲端帳號——Garmin 會把資料推送到你的帳號。</p>
        ) : gStatus && !gStatus.configured ? (
          <p className="sync-help">
            Garmin 官方直連正在等 Garmin 開發者計畫核准，開通後這裡會出現「連結」按鈕。
            現在可以先用下面的 ② 或 ③，效果一樣。
          </p>
        ) : (
          <>
            <p className="sync-help">
              用 Garmin 帳號授權一次，之後手錶每次同步，資料就自動出現在手帳裡。
              <br />
              <small>註：這條路的健康數據會存在伺服器（Garmin 推送無法端對端加密）；② ③ 則跟日記一樣加密同步。</small>
            </p>
            <div className="data-actions">
              {gStatus?.linked ? (
                <>
                  <button disabled={gBusy} onClick={gPull}>
                    ↻ 立即更新
                  </button>
                  <button
                    disabled={gBusy}
                    onClick={() => {
                      if (!confirm('解除 Garmin 連結？伺服器上的 Garmin 健康數據會一併刪除（手帳裡已同步的保留）。'))
                        return
                      gRun(async () => {
                        await garminUnlink()
                        setGStatus((s) => (s ? { ...s, linked: false } : s))
                        setGMsg('已解除連結')
                      })
                    }}
                  >
                    解除連結
                  </button>
                </>
              ) : (
                <button disabled={gBusy || !gStatus} onClick={() => gRun(garminConnect)}>
                  🔗 連結 Garmin
                </button>
              )}
            </div>
          </>
        )}
        {gMsg && <p className="sync-status">{gMsg}</p>}

        {/* ② Apple 健康 */}
        <div className="label" style={{ marginTop: 16 }}>② Apple 健康（iPhone）</div>
        {appleHealthPlatform() && ahAvail ? (
          <>
            <p className="sync-help">
              在 <b>Garmin Connect app → 更多 → 設定 → 連接的應用程式 → Apple 健康</b> 打開同步，
              再按下面授權。之後每次打開一刻都會自動讀最新兩週。
            </p>
            <div className="data-actions">
              <button onClick={() => ahSync(30)}>{ahOn ? '↻ 立即同步' : '🍎 授權並同步'}</button>
              {ahOn && <button onClick={() => ahSync(365)}>補齊一年</button>}
              {ahOn && (
                <button
                  onClick={() => {
                    setAppleHealthEnabled(false)
                    setAhOn(false)
                    setAhMsg('已停止自動同步（已讀進來的資料保留）')
                  }}
                >
                  停止
                </button>
              )}
            </div>
            {ahOn && last && !ahMsg && (
              <p className="sync-status">上次同步：{new Date(last).toLocaleString('zh-TW')}</p>
            )}
          </>
        ) : (
          <p className="sync-help">
            用 iPhone 上的一刻 app 開這裡即可（網頁版讀不到 Apple 健康）。
            Garmin Connect 開啟 Apple 健康同步後，睡眠、步數、心率、HRV 都會跟著進來。
          </p>
        )}
        {ahMsg && <p className="sync-status">{ahMsg}</p>}

        {/* ③ 匯入檔案 */}
        <div className="label" style={{ marginTop: 16 }}>③ 匯入 Garmin 匯出檔（補歷史）</div>
        <p className="sync-help">
          到{' '}
          <a href="https://www.garmin.com/account/datamanagement/exportdata/" target="_blank" rel="noreferrer">
            Garmin 帳號 → 資料管理 → 匯出你的資料
          </a>
          ，收到 Email 後下載 zip，直接選它就好（全部在你的裝置上解析，不會上傳原始檔）。
          也吃單一 JSON（UDSFile、sleepData、HRV…）與 Garmin Connect 報告匯出的 CSV。
        </p>
        <div className="data-actions">
          <label>
            📦 選擇檔案（zip／json／csv）
            <input
              ref={fileRef}
              type="file"
              accept=".zip,.json,.csv,application/zip,application/json,text/csv"
              multiple
              hidden
              onChange={(e) => onFiles(e.target.files)}
            />
          </label>
        </div>
        {fMsg && <p className="sync-status">{fMsg}</p>}
      </div>
    </>
  )
}
