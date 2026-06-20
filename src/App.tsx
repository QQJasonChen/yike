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
import { focusLock } from './focusLock'
import { openFloating, pipAutoEnabled, pipSupported, setPipTimerSource } from './pip'
import {
  currentStreak,
  loadDay,
  loadSettings,
  mondayOf,
  monthOf,
  quarterOf,
  recentNames,
  saveSettings,
  toDateKey,
} from './storage'
import { Settings } from './types'

type Tab = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'schedule' | 'life' | 'history'

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

  const streak = currentStreak(todayKey)
  const todayFocusSessions = loadDay(todayKey).tasks.reduce((s, t) => s + t.done, 0)
  // 歷史名稱 → 全域自動完成；刻意在切換分頁時重算（抓到剛新增的名稱）
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const names = useMemo(() => recentNames(), [tab])

  return (
    <>
      <datalist id="yike-names">
        {names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
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
          <button className="gear-btn" onClick={() => setShowSettings(true)} title="設定">
            ⚙
          </button>
          {todayFocusSessions > 0 && (
            <span className="today-focus">{todayFocusSessions}⊙</span>
          )}
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
        />
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
