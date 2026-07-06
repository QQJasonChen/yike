import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cloudEnabled, currentEmail, startAutoSync } from './cloud'
import DayView from './DayView'
import WeekView from './WeekView'
import MonthView from './MonthView'
import QuarterView from './QuarterView'
import YearView from './YearView'
import ScheduleView from './ScheduleView'
import LifeView from './LifeView'
import HistoryView from './HistoryView'
import SettingsPanel from './SettingsPanel'
import FocusTimer, { TimerState } from './FocusTimer'
import Onboarding from './Onboarding'
import { notify } from './notify'
import { searchAll, SearchTarget } from './search'
import { focusLock } from './focusLock'
import { openFloating, pipAutoEnabled, pipSupported, setPipTimerSource } from './pip'
import {
  autoBackup,
  currentStreak,
  loadSettings,
  mondayOf,
  monthOf,
  quarterOf,
  saveSettings,
  toDateKey,
} from './storage'
import { Settings } from './types'

type Tab = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'schedule' | 'life' | 'history'

// 把命中的關鍵字標色
const highlightMatch = (text: string, q: string): React.ReactNode => {
  const ql = q.trim().toLowerCase()
  if (!ql) return text
  const lower = text.toLowerCase()
  const out: React.ReactNode[] = []
  let i = 0
  let key = 0
  let idx = lower.indexOf(ql)
  while (idx !== -1) {
    if (idx > i) out.push(text.slice(i, idx))
    out.push(
      <mark key={key++} className="sh-mark">
        {text.slice(idx, idx + ql.length)}
      </mark>
    )
    i = idx + ql.length
    idx = lower.indexOf(ql, i)
  }
  out.push(text.slice(i))
  return out
}

export default function App() {
  const todayKey = toDateKey(new Date())
  const [tab, setTab] = useState<Tab>('day')
  const [dateKey, setDateKey] = useState(todayKey)
  const [mondayKey, setMondayKey] = useState(() => mondayOf(todayKey))
  const [monthKey, setMonthKey] = useState(() => monthOf(todayKey))
  const [quarterKey, setQuarterKey] = useState(() => quarterOf(todayKey))
  const [yearNum, setYearNum] = useState(() => Number(todayKey.slice(0, 4)))
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [timer, setTimer] = useState<TimerState | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchSel, setSearchSel] = useState(0)
  const searchHits = useMemo(() => (searchOpen ? searchAll(searchQuery) : []), [searchOpen, searchQuery])
  // 選取項捲進視野
  useEffect(() => {
    document.querySelector('.search-hit.sel')?.scrollIntoView({ block: 'nearest' })
  }, [searchSel])

  // 每日本機備份（安全網）：開站快照一次今天的資料，保留最近 7 份
  useEffect(() => {
    autoBackup(toDateKey(new Date()))
  }, [])

  // ⌘K / Ctrl+K 開搜尋；Esc 關
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen((v) => !v)
      } else if (e.key === 'Escape') {
        setSearchOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const [copiedMsg, setCopiedMsg] = useState('')
  const flashCopied = (msg: string) => {
    setCopiedMsg(msg)
    setTimeout(() => setCopiedMsg(''), 1500)
  }
  const copyHit = (h: { when: string; text: string }) => {
    navigator.clipboard
      .writeText(`[${h.when}] ${h.text}`)
      .then(() => flashCopied('✓ 已複製'))
      .catch(() => flashCopied('複製失敗'))
  }
  const copyAllHits = () => {
    const md = searchHits.map((h) => `- [${h.when}] ${h.kind}：${h.text}`).join('\n')
    navigator.clipboard
      .writeText(md)
      .then(() => flashCopied(`✓ 已複製 ${searchHits.length} 筆`))
      .catch(() => flashCopied('複製失敗'))
  }

  const goTo = (t: SearchTarget) => {
    if (t.tab === 'day') setDateKey(t.dateKey)
    else if (t.tab === 'week') setMondayKey(t.mondayKey)
    else if (t.tab === 'month') setMonthKey(t.monthKey)
    else if (t.tab === 'quarter') setQuarterKey(t.quarterKey)
    else if (t.tab === 'year') setYearNum(t.yearNum)
    setTab(t.tab)
    setSearchOpen(false)
    setSearchQuery('')
  }
  // 首次開啟引導：沒看過、且還沒有任何一天的資料（老用戶不打擾）
  const [showOnboarding, setShowOnboarding] = useState(() => {
    if (localStorage.getItem('pp:onboarded') === '1') return false
    for (let i = 0; i < localStorage.length; i++) {
      if (localStorage.key(i)?.startsWith('pp:day:')) return false
    }
    return true
  })
  const dismissOnboarding = () => {
    localStorage.setItem('pp:onboarded', '1')
    setShowOnboarding(false)
  }
  const sessionSink = useRef<((taskIndex: number, startMs: number, endMs: number) => void) | null>(null)

  // 浮窗讀「目前計時狀態」的即時來源（用 ref 避免每次 render 重註冊）
  const timerRef = useRef<TimerState | null>(timer)
  timerRef.current = timer
  useEffect(() => setPipTimerSource(() => timerRef.current), [])
  // 安全網：每次開 App 若沒有進行中的計時，確保專注鎖已解除（避免殘留鎖死）
  useEffect(() => {
    if (!timerRef.current) focusLock.stop()
  }, [])

  const updateSettings = (s: Settings) => {
    setSettings(s)
    saveSettings(s)
  }

  const startFocus = (taskIndex: number, taskText: string) => {
    // 計時永遠記在「今天」的頁面上
    setDateKey(todayKey)
    const ms = settings.focusMinutes * 60_000
    setTimer({
      taskIndex,
      taskText,
      phase: 'focus',
      totalMs: ms,
      endsAt: Date.now() + ms,
      pausedRemaining: null,
      startedAt: Date.now(),
    })
    // 預設：開始專注就自動浮出置頂小窗（沿用此次點擊的使用者手勢）
    if (pipSupported() && pipAutoEnabled()) openFloating()
  }

  const registerSessionSink = useCallback((fn: (taskIndex: number, startMs: number, endMs: number) => void) => {
    sessionSink.current = fn
  }, [])

  // 計時中放棄（✕）→ 種樹主題記一棵枯樹（管線同 sessionSink）
  const abandonSink = useRef<((taskIndex: number) => void) | null>(null)
  const registerAbandonSink = useCallback((fn: (taskIndex: number) => void) => {
    abandonSink.current = fn
  }, [])

  // 雲端登入狀態（頂欄 badge 用）
  const [cloudIn, setCloudIn] = useState<boolean | null>(null)
  useEffect(() => {
    if (!cloudEnabled()) return
    currentEmail().then((e) => setCloudIn(Boolean(e)))
  }, [tab])

  // 已登入雲端帳號時：開站自動同步＋寫入自動推送
  useEffect(() => {
    startAutoSync()
  }, [])

  // 每日提醒：開 app 時重新排程一次，確保通知與目前設定一致
  useEffect(() => {
    if (settings.reminderEnabled) notify.setDailyReminder(true, settings.reminderTime)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const streak = currentStreak(todayKey)
  return (
    <>
      <div className="topbar">
        <span className="brand">一刻手帳 Yike</span>
        <nav className="tabs">
          <button className={tab === 'day' ? 'active' : ''} onClick={() => setTab('day')}>
            今天
          </button>
          <button className={tab === 'week' ? 'active' : ''} onClick={() => setTab('week')}>
            週
          </button>
          <button className={tab === 'month' ? 'active' : ''} onClick={() => setTab('month')}>
            月
          </button>
          <button className={tab === 'quarter' ? 'active' : ''} onClick={() => setTab('quarter')}>
            季
          </button>
          <button className={tab === 'year' ? 'active' : ''} onClick={() => setTab('year')}>
            年
          </button>
          <button className={tab === 'schedule' ? 'active' : ''} onClick={() => setTab('schedule')}>
            時程
          </button>
          <button className={tab === 'life' ? 'active' : ''} onClick={() => setTab('life')}>
            願景
          </button>
          <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
            回顧
          </button>
        </nav>
        <span className="streak">
          {cloudEnabled() && (
            <button
              className={`cloud-badge ${cloudIn ? 'on' : ''}`}
              onClick={() => setShowSettings(true)}
              title={cloudIn ? '雲端同步中，點擊管理' : '登入帳號，啟用全裝置自動同步'}
            >
              {cloudIn ? '☁ 同步中' : '☁ 登入'}
            </button>
          )}
          <button
            className="gear-btn"
            onClick={() => setSearchOpen(true)}
            title="搜尋全部紀錄（⌘K）"
            aria-label="搜尋全部紀錄"
          >
            🔍
          </button>
          <button
            className="gear-btn"
            onClick={() => setShowSettings(true)}
            title="設定"
            aria-label="設定"
          >
            ⚙
          </button>
          {streak > 0 ? (
            <>
              <strong>{streak}</strong> 天連續
            </>
          ) : (
            '今天開始'
          )}
        </span>
      </div>

      {tab === 'day' && (
        <DayView
          dateKey={dateKey}
          onDateChange={setDateKey}
          timer={timer}
          onStartFocus={startFocus}
          settings={settings}
          onSettingsChange={updateSettings}
          registerSessionSink={registerSessionSink}
          registerAbandonSink={registerAbandonSink}
        />
      )}
      {tab === 'week' && (
        <WeekView
          mondayKey={mondayKey}
          onWeekChange={setMondayKey}
          settings={settings}
          onSettingsChange={updateSettings}
          onOpenDay={(k) => {
            setDateKey(k)
            setTab('day')
          }}
        />
      )}
      {tab === 'month' && (
        <MonthView
          monthKey={monthKey}
          onMonthChange={setMonthKey}
          settings={settings}
          onOpenDay={(k) => {
            setDateKey(k)
            setTab('day')
          }}
        />
      )}
      {tab === 'quarter' && (
        <QuarterView
          quarterKey={quarterKey}
          onQuarterChange={setQuarterKey}
          settings={settings}
        />
      )}
      {tab === 'year' && (
        <YearView
          year={yearNum}
          onYearChange={setYearNum}
          settings={settings}
          onOpenDay={(k) => {
            setDateKey(k)
            setTab('day')
          }}
        />
      )}
      {tab === 'schedule' && <ScheduleView />}
      {tab === 'life' && <LifeView />}
      {tab === 'history' && (
        <HistoryView
          onOpenDay={(k) => {
            setDateKey(k)
            setTab('day')
          }}
          settings={settings}
        />
      )}

      {/* 手機底部原生式 tab bar（桌機隱藏，見 CSS） */}
      <nav className="tab-bar">
        {([
          ['day', '今天'],
          ['week', '週'],
          ['month', '月'],
          ['schedule', '時程'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            className={tab === t ? 'active' : ''}
            onClick={() => {
              setTab(t)
              setMoreOpen(false)
            }}
          >
            {label}
          </button>
        ))}
        <button
          className={['quarter', 'year', 'life', 'history'].includes(tab) ? 'active' : ''}
          onClick={() => setMoreOpen((v) => !v)}
        >
          更多
        </button>
        {moreOpen && (
          <>
            <div className="tab-more-backdrop" onClick={() => setMoreOpen(false)} />
            <div className="tab-more">
              {([
                ['quarter', '季'],
                ['year', '年'],
                ['life', '願景'],
                ['history', '回顧'],
              ] as [Tab, string][]).map(([t, label]) => (
                <button
                  key={t}
                  className={tab === t ? 'active' : ''}
                  onClick={() => {
                    setTab(t)
                    setMoreOpen(false)
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
      </nav>

      {timer && (
        <FocusTimer
          timer={timer}
          onUpdate={setTimer}
          breakMinutes={settings.breakMinutes}
          focusMinutes={settings.focusMinutes}
          autoLoop={settings.autoLoop}
          lockApps={settings.focusLock}
          onSessionDone={(ti, s, e) => sessionSink.current?.(ti, s, e)}
          onAbandon={(ti) => abandonSink.current?.(ti)}
          treeStyle={settings.focusStyle === 'tree'}
        />
      )}

      {showOnboarding && <Onboarding onClose={dismissOnboarding} />}

      {searchOpen && (
        <div className="search-overlay" onClick={() => setSearchOpen(false)}>
          <div className="search-box" onClick={(e) => e.stopPropagation()}>
            <input
              className="search-input"
              autoFocus
              placeholder="搜尋所有紀錄：任務、反思、目標、亮點…"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setSearchSel(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setSearchSel((s) => Math.min(s + 1, searchHits.length - 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setSearchSel((s) => Math.max(s - 1, 0))
                } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  const h = searchHits[searchSel]
                  if (h) goTo(h.target)
                }
              }}
            />
            {searchHits.length > 0 && (
              <div className="search-meta">
                <span>
                  {searchHits.length} 筆{copiedMsg && ` ・ ${copiedMsg}`}
                </span>
                <button className="search-copyall" onClick={copyAllHits}>
                  📋 複製全部
                </button>
              </div>
            )}
            <div className="search-results">
              {searchQuery.trim() && searchHits.length === 0 && (
                <p className="search-empty">沒有找到「{searchQuery}」</p>
              )}
              {searchHits.map((h, i) => (
                <button
                  key={h.id}
                  className={`search-hit ${i === searchSel ? 'sel' : ''}`}
                  onClick={() => goTo(h.target)}
                  onMouseEnter={() => setSearchSel(i)}
                >
                  <span className="sh-kind">{h.kind}</span>
                  <span className="sh-when">{h.when}</span>
                  <span className="sh-text">{highlightMatch(h.text, searchQuery)}</span>
                  <span
                    className="sh-copy"
                    title="複製這筆"
                    onClick={(e) => {
                      e.stopPropagation()
                      copyHit(h)
                    }}
                  >
                    ⧉
                  </span>
                </button>
              ))}
            </div>
            {!searchQuery.trim() && (
              <p className="search-tip">
                跨 日／週／月／季／年／願景 全文搜尋・點結果直接跳過去・⌘K 開關
              </p>
            )}
          </div>
        </div>
      )}

      {showSettings && (
        <SettingsPanel
          settings={settings}
          onSettingsChange={updateSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </>
  )
}
