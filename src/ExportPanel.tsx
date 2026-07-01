import { useState } from 'react'
import { allDayKeys, loadDay, toDateKey } from './storage'
import { dayToMarkdown } from './exportMd'
import {
  RangePreset,
  extractNotionPageId,
  downloadMarkdown,
  loadNotionConfig,
  presetRange,
  pushToNotion,
  saveNotionConfig,
} from './integrations'
import { Settings } from './types'

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: 'today', label: '今天' },
  { key: 'last7', label: '近 7 天' },
  { key: 'week', label: '本週' },
  { key: 'month', label: '本月' },
]

interface Props {
  settings: Settings
}

/** 匯出到第二大腦：選時間範圍 → 複製（Heptabase）/ 下載 .md / 直送 Notion */
export default function ExportPanel({ settings }: Props) {
  const todayKey = toDateKey(new Date())
  const [from, setFrom] = useState(() => presetRange('last7', todayKey).from)
  const [to, setTo] = useState(todayKey)
  const [preset, setPreset] = useState<RangePreset | 'custom'>('last7')
  const [msg, setMsg] = useState<{ text: string; url?: string; err?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  // Notion 設定
  const [cfg, setCfg] = useState(() => loadNotionConfig())
  const [showSetup, setShowSetup] = useState(false)
  const [tokenDraft, setTokenDraft] = useState(cfg?.token ?? '')
  const [pageDraft, setPageDraft] = useState(cfg?.parentUrl ?? '')

  const applyPreset = (p: RangePreset) => {
    const r = presetRange(p, todayKey)
    setPreset(p)
    setFrom(r.from)
    setTo(r.to)
  }

  /** 範圍內有記錄的每天串成一份 Markdown；沒資料回 null */
  const buildMarkdown = (): { title: string; md: string } | null => {
    const lo = from <= to ? from : to
    const hi = from <= to ? to : from
    const keys = allDayKeys()
      .filter((k) => k >= lo && k <= hi)
      .sort()
    if (keys.length === 0) return null
    const md = keys
      .map((k) => dayToMarkdown(k, loadDay(k), settings.morningQs, settings.eveningQs))
      .join('\n\n---\n\n')
    const title = lo === hi ? `一刻手帳 ${lo}` : `一刻手帳 ${lo} → ${hi}`
    return { title, md }
  }

  const flash = (text: string, err = false, url?: string) => {
    setMsg({ text, err, url })
    if (!err) setTimeout(() => setMsg((m) => (m?.text === text ? null : m)), 6000)
  }

  const doCopy = async () => {
    const out = buildMarkdown()
    if (!out) return flash('這段日期內沒有任何記錄。', true)
    try {
      await navigator.clipboard.writeText(out.md)
      flash('✓ 已複製——貼到 Heptabase 的 journal 或新卡片即可')
    } catch {
      flash('複製失敗', true)
    }
  }

  const doDownload = () => {
    const out = buildMarkdown()
    if (!out) return flash('這段日期內沒有任何記錄。', true)
    downloadMarkdown(`${out.title.replace(/\s/g, '')}.md`, `# ${out.title}\n\n${out.md}`)
    flash('✓ 已下載 .md——拖進 Heptabase 白板即成卡片')
  }

  const doNotion = async () => {
    if (!cfg) {
      setShowSetup(true)
      flash('先完成下方的 Notion 設定（一次就好，約 1 分鐘）', true)
      return
    }
    const out = buildMarkdown()
    if (!out) return flash('這段日期內沒有任何記錄。', true)
    setBusy(true)
    try {
      const r = await pushToNotion(cfg, out.title, out.md)
      flash('✓ 已送到你的 Notion', false, r.url)
    } catch (e) {
      flash(e instanceof Error ? e.message : '匯出失敗', true)
    } finally {
      setBusy(false)
    }
  }

  const doSaveSetup = async (test: boolean) => {
    const pageId = extractNotionPageId(pageDraft)
    if (!tokenDraft.trim()) return flash('請先貼上 Integration Secret（步驟 1）', true)
    if (!pageId) return flash('看不懂這個頁面連結——請直接複製 Notion 頁面的分享連結', true)
    const next = { token: tokenDraft.trim(), parentPageId: pageId, parentUrl: pageDraft.trim() }
    if (test) {
      setBusy(true)
      try {
        await pushToNotion(next, '', '', true)
      } catch (e) {
        setBusy(false)
        return flash(e instanceof Error ? e.message : '連線測試失敗', true)
      }
      setBusy(false)
    }
    saveNotionConfig(next)
    setCfg(next)
    setShowSetup(false)
    flash(test ? '✓ 連線成功，設定已儲存——以後一鍵直送' : '✓ 設定已儲存')
  }

  return (
    <>
      <div className="label" style={{ marginTop: 18 }}>
        匯出到第二大腦{' '}
        <span className="hint">選一段時間，一鍵送到你自己的 Notion / Heptabase</span>
      </div>
      <div className="period-tabs">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            className={`period-tab ${preset === p.key ? 'on' : ''}`}
            onClick={() => applyPreset(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="md-range">
        <input
          type="date"
          value={from}
          max={to}
          onChange={(e) => {
            setFrom(e.target.value)
            setPreset('custom')
          }}
        />
        <span className="md-range-sep">→</span>
        <input
          type="date"
          value={to}
          min={from}
          onChange={(e) => {
            setTo(e.target.value)
            setPreset('custom')
          }}
        />
      </div>
      <div className="data-actions">
        <button onClick={doCopy} title="複製這段時間的 Markdown，貼到 Heptabase journal / 卡片，或任何筆記軟體">
          ⧉ 複製給 Heptabase
        </button>
        <button onClick={doDownload} title="下載 .md 檔——拖進 Heptabase 白板即成卡片">
          ⬇ 下載 .md
        </button>
        <button onClick={doNotion} disabled={busy} title="直送到你自己的 Notion 頁面（首次需 1 分鐘設定）">
          {busy ? '傳送中…' : '🚀 送到 Notion'}
        </button>
        <button className="link-btn" onClick={() => setShowSetup((s) => !s)}>
          {cfg ? '⚙ Notion 設定' : '⚙ 設定 Notion'}
        </button>
      </div>
      {msg && (
        <p className="sync-help" style={{ color: msg.err ? 'var(--terra)' : undefined }}>
          {msg.text}
          {msg.url && (
            <>
              {' '}
              <a href={msg.url} target="_blank" rel="noreferrer">
                開啟頁面 →
              </a>
            </>
          )}
        </p>
      )}
      {showSetup && (
        <div className="sync-box" style={{ marginTop: 10 }}>
          {cfg && (
            <p className="sync-help">
              ✓ 目前已連結頁面：
              <a href={cfg.parentUrl} target="_blank" rel="noreferrer">
                {cfg.parentUrl.length > 52 ? `${cfg.parentUrl.slice(0, 52)}…` : cfg.parentUrl}
              </a>
            </p>
          )}
          <p className="sync-help">
            連你<b>自己的 Notion</b>（資料不經過任何人的帳號）：
            <br />
            1. 開{' '}
            <a href="https://www.notion.so/my-integrations" target="_blank" rel="noreferrer">
              notion.so/my-integrations
            </a>{' '}
            → New integration（名稱隨意，選你的 workspace）→ 複製 <b>Internal Integration Secret</b>
            <br />
            2. 在 Notion 建一個接收匯出的頁面 → 右上 <b>⋯ → Connections</b> → 加入剛建的 integration
            <br />
            3. 複製該頁面連結，貼在下面
          </p>
          <div className="line-input sync-token">
            <input
              type="password"
              placeholder="Internal Integration Secret（ntn_…）"
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value.trim())}
            />
          </div>
          <div className="line-input sync-token">
            <input
              type="text"
              placeholder="接收頁面的連結（https://www.notion.so/…）"
              value={pageDraft}
              onChange={(e) => setPageDraft(e.target.value)}
            />
          </div>
          <div className="data-actions" style={{ marginTop: 12 }}>
            <button disabled={busy} onClick={() => doSaveSetup(true)}>
              {busy ? '測試中…' : '測試連線並儲存'}
            </button>
            <button className="link-btn" onClick={() => doSaveSetup(false)}>
              直接儲存
            </button>
            {cfg && (
              <button
                className="link-btn"
                onClick={() => {
                  saveNotionConfig(null)
                  setCfg(null)
                  setTokenDraft('')
                  setPageDraft('')
                  flash('已清除 Notion 設定')
                }}
              >
                清除設定
              </button>
            )}
          </div>
          <p className="sync-help" style={{ marginTop: 8 }}>
            Secret 只存在<b>這台裝置</b>的瀏覽器裡，匯出時經加密連線無狀態轉發給 Notion，不儲存、不記錄。
          </p>
        </div>
      )}
    </>
  )
}
