import { useEffect, useMemo, useRef, useState } from 'react'
import { cloudEnabled, startAutoSync, stopAutoSync } from './cloud'
import { changedFields, useStoredEntry } from './useStoredEntry'
import { TIMER_KEY, claimTimerCompletion, loadTimer, newTimerId, recordAbandon, recordFocusSession, renewSegmentForToday, saveTimer, supersededOnDisk } from './focusSession'
import { resolveTaskForToday } from './focusTask'
import { editStoredKey, hasUnsavedDraftsFor } from './useStoredEntry'
import { watchOwnerChange } from './ownerWatch'
import { useCloudAuthStatus } from './useCloudAuthStatus'
import DayView from './DayView'
import WeekView from './WeekView'
import MonthView from './MonthView'
import QuarterView from './QuarterView'
import YearView from './YearView'
import ScheduleView from './ScheduleView'
import LifeView from './LifeView'
import BizModelView from './BizModelView'
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
  getDataOwner,
  loadDay,
  loadSettings,
  mondayOf,
  monthOf,
  quarterOf,
  saveDay,
  saveSettings,
  setOnWriteError,
  toDateKey,
} from './storage'
import { Settings } from './types'

type Tab = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'schedule' | 'life' | 'biz' | 'history'

// 分頁 ↔ 網址 hash：每個分頁有自己「一看就懂」的小網址（yikeday.com/#business 直接開商模）
const TAB_SLUG: Record<Tab, string> = {
  day: 'today',
  week: 'week',
  month: 'month',
  quarter: 'quarter',
  year: 'year',
  schedule: 'schedule',
  life: 'vision',
  biz: 'business',
  history: 'review',
}
const SLUG_TAB: Record<string, Tab> = Object.fromEntries(
  Object.entries(TAB_SLUG).map(([t, s]) => [s, t as Tab])
) as Record<string, Tab>
const tabFromHash = (): Tab => {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, '').trim()).toLowerCase()
  return SLUG_TAB[h] ?? 'day'
}

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
  const [tab, setTab] = useState<Tab>(tabFromHash)
  const [dateKey, setDateKey] = useState(todayKey)
  const [mondayKey, setMondayKey] = useState(() => mondayOf(todayKey))
  const [monthKey, setMonthKey] = useState(() => monthOf(todayKey))
  const [quarterKey, setQuarterKey] = useState(() => quarterOf(todayKey))
  const [yearNum, setYearNum] = useState(() => Number(todayKey.slice(0, 4)))
  const { entry: settings, edit: editSettings } = useStoredEntry<Settings>('pp:settings', loadSettings, saveSettings)
  const [writeFailed, setWriteFailed] = useState(false)
  const [ownerChanged, setOwnerChanged] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [timer, setTimer] = useState<TimerState | null>(loadTimer)
  // 本地操作（開始／暫停／恢復／進休息／結束）走這個：版本 +1，讓同一段的落盤只准較新的贏。
  // 從 storage 事件收進來的、owner 變更的清空走原本的 setTimer，不加版本。
  const setTimerLocal = (t: TimerState | null) => setTimer(t ? { ...t, rev: (t.rev ?? 0) + 1 } : null)
  const [showSettings, setShowSettings] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [focusMitSignal, setFocusMitSignal] = useState(0)

  useEffect(() => {
    setOnWriteError(() => setWriteFailed(true))
    return () => setOnWriteError(null)
  }, [])
  useEffect(() => {
    const onStatus = (event: Event) => {
      const message = (event as CustomEvent<{ message: string }>).detail?.message
      if (typeof message === 'string') setSyncMessage(message)
    }
    window.addEventListener('yike:sync-status', onStatus)
    return () => window.removeEventListener('yike:sync-status', onStatus)
  }, [])
  // startFocus 用的 owner 基準：跟 useStoredEntry 一樣在 mount 時記下、只在本地登入流程
  // 發 local-owner-ready 時更新。換帳號途中（owner 已改、畫面還是上一個人的）按 ▶，
  // 原本會把 A 的任務文字寫進 B 的今天、而且 timer.owner 記成 B 讓後面的守衛也放行（Codex #1）。
  const ownerRef = useRef<string | null>(getDataOwner())
  useEffect(() => {
    const stop = () => {
      stopAutoSync()
      setTimer(null)
      focusLock.stop()
      setOwnerChanged(true)
    }
    const unwatch = watchOwnerChange(stop)
    const ready = () => {
      // 跟 useStoredEntry 同一條規則：上一個人還有存不進去的草稿時，畫面不接受新主人（它會保留舊畫面）。
      // 這裡若無條件換成新主人，startFocus 的守衛就會放行，把舊畫面上的任務寫進新帳號（Codex 第 5 輪 #1）
      if (hasUnsavedDraftsFor(ownerRef.current)) {
        setOwnerChanged(true)
        return
      }
      ownerRef.current = getDataOwner()
      setTimer(null)
      focusLock.stop()
    }
    window.addEventListener('yike:owner-change-blocked', stop)
    window.addEventListener('yike:local-owner-ready', ready)
    return () => {
      unwatch()
      window.removeEventListener('yike:owner-change-blocked', stop)
      window.removeEventListener('yike:local-owner-ready', ready)
    }
  }, [])
  // 另一個分頁改了計時狀態（提前完成、暫停、放棄）→ 這邊跟著換，不要各算各的到點各記一次
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === TIMER_KEY || e.key === null) setTimer(loadTimer())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // widget 桌面「✏️ 寫下」→ 開到今天並聚焦最重要任務輸入框
  useEffect(() => {
    const onWriteMit = () => {
      setDateKey(todayKey)
      setTab('day')
      setFocusMitSignal((n) => n + 1)
    }
    window.addEventListener('yike:write-mit', onWriteMit)
    return () => window.removeEventListener('yike:write-mit', onWriteMit)
  }, [todayKey])
  const [searchSel, setSearchSel] = useState(0)
  const searchHits = useMemo(() => (searchOpen ? searchAll(searchQuery) : []), [searchOpen, searchQuery])
  // 選取項捲進視野
  useEffect(() => {
    document.querySelector('.search-hit.sel')?.scrollIntoView({ block: 'nearest' })
  }, [searchSel])

  // 每日本機備份（安全網）：開站快照一次今天的資料，保留最近 7 份
  useEffect(() => {
    if (!autoBackup(toDateKey(new Date()))) setWriteFailed(true)
  }, [])

  // ⌘K / Ctrl+K 開搜尋；Esc 關掉「最上層」的浮層（搜尋 → 設定 → 更多）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setShowSettings(false) // 開搜尋時關設定，避免兩個浮層疊在一起
        setSearchOpen((v) => !v)
      } else if (e.key === 'Escape') {
        if (searchOpen) setSearchOpen(false)
        else if (showSettings) setShowSettings(false)
        else if (moreOpen) setMoreOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [searchOpen, showSettings, moreOpen])

  // 分頁 → 網址：切分頁就把網址 hash 同步過去（今天＝預設，保持乾淨網址；#today 也能開）
  useEffect(() => {
    const slug = TAB_SLUG[tab]
    if (tab === 'day') {
      if (location.hash) history.replaceState(null, '', location.pathname + location.search)
    } else if (location.hash !== `#${slug}`) {
      history.replaceState(null, '', `#${slug}`)
    }
  }, [tab])

  // 網址 → 分頁：有人貼帶 hash 的連結或手動改網址時，跳到對應分頁
  useEffect(() => {
    const onHash = () => setTab((cur) => (tabFromHash() !== cur ? tabFromHash() : cur))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const [copiedMsg, setCopiedMsg] = useState('')
  const flashCopied = (msg: string) => {
    setCopiedMsg(msg)
    setTimeout(() => setCopiedMsg(''), 1500)
  }
  // 完成一段專注的慶祝浮字（種樹主題＝種下一棵樹）——專注的情感回饋
  const [focusToast, setFocusToast] = useState('')
  const celebrate = (msg: string) => {
    setFocusToast(msg)
    setTimeout(() => setFocusToast(''), 2200)
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

  // 浮窗讀「目前計時狀態」的即時來源（用 ref 避免每次 render 重註冊）
  const timerRef = useRef<TimerState | null>(timer)
  timerRef.current = timer
  // 計時狀態落地：App 被殺（iOS 清記憶體、使用者滑掉）再開，計時器原本就消失了。
  // 只存絕對時間戳，重開用現在時間重算。清成 null 時帶上「剛才那段的 id」，
  // 磁碟上若已是別人（另一帳號／另一分頁）的新計時就不碰它。
  const prevTimerId = useRef<string | undefined>(timer?.id)
  useEffect(() => {
    void saveTimer(timer, prevTimerId.current)
    prevTimerId.current = timer?.id
  }, [timer])
  useEffect(() => setPipTimerSource(() => timerRef.current), [])
  // 安全網：每次開 App 若沒有進行中的計時，確保專注鎖已解除（避免殘留鎖死）
  useEffect(() => {
    if (!timerRef.current) focusLock.stop()
  }, [])

  const updateSettings = (s: Settings) => {
    const patch = changedFields(settings, s)
    editSettings((base) => ({ ...base, ...patch }))
  }

  const startFocus = (taskIndex: number, taskText: string, taskId?: string) => {
    // 計時中又按播放：原本直接蓋掉，已經跑掉的時間無聲消失。要問過本人。
    const running = timerRef.current
    if (running) {
      const same = running.taskIndex === taskIndex && running.taskText === taskText
      const mins = Math.max(0, Math.round((Date.now() - running.startedAt) / 60_000))
      if (
        !confirm(
          same
            ? `這個任務正在計時（已過 ${mins} 分鐘）。重新開始會放棄這段時間，確定嗎？`
            : `「${running.taskText}」正在計時（已過 ${mins} 分鐘）。改成計時「${taskText}」會放棄那一段，確定嗎？`
        )
      )
        return
      // 確認框開著時另一個分頁可能已經完成這段、開了新的一段——接受那個過期的確認會把
      // 別人的新計時換掉（Codex 第 7 輪 #2）。磁碟上有更新的一段就不開始。
      if (supersededOnDisk(running)) return
    }
    // 換帳號途中不准開始：畫面上的任務還是上一個人的
    if (getDataOwner() !== ownerRef.current) {
      window.dispatchEvent(new Event('yike:owner-change-blocked'))
      return
    }
    // 日期要用「按下的當下」算：App 的 todayKey 是 render 時算的，23:59 開著不動、00:01 按 ▶，
    // 閉包裡還是昨天，整段會記到昨天（Codex 第 4 輪 #1）
    const todayKey = toDateKey(new Date())
    // 計時永遠記在「今天」的頁面上——所以任務也必須在「今天」定位一次。
    // 原本直接把畫面上的 index 帶進今天：在昨天的第 3 列按 ▶，完成後那 25 分鐘會塗到
    // 今天的第 3 列（可能是完全不同的任務或空白列）。
    // 寫入走 editStoredKey：跟畫面編輯同一套 owner 守衛與草稿基準。
    // 解析要在 change 回呼裡依 base 做：base 可能是存不進去的草稿，先用 storage 舊版算好
    // 再整個 tasks 覆蓋上去，會把別列的草稿丟掉（Codex 第 2 輪 #2）
    const box: { r: ReturnType<typeof resolveTaskForToday> | null } = { r: null }
    const written = editStoredKey(
      `pp:day:${todayKey}`,
      () => loadDay(todayKey),
      (v) => saveDay(todayKey, v),
      (base) => {
        box.r = resolveTaskForToday(base, taskIndex, taskText, taskId)
        return box.r.changed ? { ...base, tasks: box.r.tasks } : base
      },
      ownerRef.current
    )
    const r = box.r
    if (!written || !r) return
    taskIndex = r.index
    setDateKey(todayKey)
    const ms = settings.focusMinutes * 60_000
    setTimerLocal({
      id: newTimerId(),
      dateKey: todayKey,
      taskIndex,
      taskId: r.taskId,
      owner: ownerRef.current,
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


  // 雲端登入狀態（頂欄 badge 用）
  const cloudIn = useCloudAuthStatus()

  // 已登入雲端帳號時：開站自動同步＋寫入自動推送
  useEffect(() => {
    void startAutoSync((message) => { setSyncMessage(message); window.dispatchEvent(new Event('yike:backup-change')) })
    return () => stopAutoSync()
  }, [])

  // 每日提醒：開 app 時重新排程一次，確保通知與目前設定一致
  useEffect(() => {
    if (settings.reminderEnabled) notify.setDailyReminder(true, settings.reminderTime)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const streak = currentStreak(todayKey)
  if (ownerChanged) return (
    <div className="page"><div className="page-inner" role="alert">
      <p>這台裝置的帳號已在另一個分頁變更。已停止此畫面的編輯與同步，請重新載入。</p>
      <button onClick={() => location.reload()}>重新載入</button>
    </div></div>
  )
  return (
    <>
      {writeFailed && <div className="hint" role="alert">
        本次儲存沒有完成。請先複製畫面上的草稿，再檢查裝置儲存空間；此草稿可能尚未進入備份或雲端。
        <button onClick={() => setWriteFailed(false)}>我知道了</button>
      </div>}
      {syncMessage && <p className="hint" role="status">{syncMessage}</p>}
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
          <button className={tab === 'biz' ? 'active' : ''} onClick={() => setTab('biz')}>
            商模
          </button>
          <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
            回顧
          </button>
        </nav>
        <span className="streak">
          {cloudEnabled() && (
            <button
              className={`cloud-badge ${cloudIn ? 'on' : ''}`}
              onClick={() => {
                setSearchOpen(false)
                setShowSettings(true)
              }}
              title={cloudIn ? '已登入雲端帳號，點擊管理' : '登入帳號，啟用全裝置自動同步'}
            >
              {cloudIn ? '☁ 已登入' : '☁ 登入'}
            </button>
          )}
          <button
            className="gear-btn"
            onClick={() => {
              setShowSettings(false)
              setSearchOpen(true)
            }}
            title="搜尋全部紀錄（⌘K）"
            aria-label="搜尋全部紀錄"
          >
            🔍
          </button>
          <button
            className="gear-btn"
            onClick={() => {
              setSearchOpen(false)
              setShowSettings(true)
            }}
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
          focusMitSignal={focusMitSignal}
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
      {tab === 'biz' && <BizModelView />}
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
        <button
          className={['quarter', 'year', 'schedule', 'life', 'biz'].includes(tab) ? 'active' : ''}
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
                ['schedule', '時程'],
                ['life', '願景'],
                ['biz', '商模'],
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
          onUpdate={setTimerLocal}
          breakMinutes={settings.breakMinutes}
          focusMinutes={settings.focusMinutes}
          autoLoop={settings.autoLoop}
          lockApps={settings.focusLock}
          renewSegment={(t) => renewSegmentForToday(t, toDateKey(new Date()))}
          onSessionDone={(ti, s, e) => {
            // 直接寫進「這段計時所屬的那一天」，不經由 DayView 註冊的 callback。
            // 使用者切到週/月分頁時 DayView 沒 mount，那個 callback 是 null——
            // 鈴響了、慶祝了，一格都沒記到。
            void (async () => {
            if (!(await claimTimerCompletion(timer.id))) return // 另一個分頁已經記過這一段
            const ok = recordFocusSession({
              dateKey: timer.dateKey ?? toDateKey(new Date(timer.startedAt)),
              taskIndex: ti,
              taskId: timer.taskId,
              owner: timer.owner,
              taskText: timer.taskText,
              startMs: s,
              endMs: e,
              focusMinutes: settings.focusMinutes,
            })
            if (!ok) celebrate('⚠ 這段專注沒存進去——請檢查儲存空間或登入狀態')
            else celebrate(settings.focusStyle === 'tree' ? '🌲 種下一棵樹，繼續加油！' : '✓ 完成一段專注！')
            })()
          }}
          onAbandon={(ti) => {
            void (async () => {
              // 放棄也要認領：另一個分頁已經把這段完成（已認領）的話，不能再記一棵枯樹
              if (!(await claimTimerCompletion(timer.id))) return
              if (!recordAbandon(timer.dateKey ?? toDateKey(new Date(timer.startedAt)), ti, timer.taskId, timer.owner))
                celebrate('⚠ 沒存進去——請檢查儲存空間或登入狀態')
            })()
          }}
          treeStyle={settings.focusStyle === 'tree'}
        />
      )}

      {showOnboarding && <Onboarding onClose={dismissOnboarding} />}

      {focusToast && <div className="focus-toast">{focusToast}</div>}

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
