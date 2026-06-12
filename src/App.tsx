import { useCallback, useEffect, useRef, useState } from 'react'
import { cloudEnabled, currentEmail, startAutoSync } from './cloud'
import DayView from './DayView'
import WeekView from './WeekView'
import MonthView from './MonthView'
import YearView from './YearView'
import HistoryView from './HistoryView'
import FocusTimer, { TimerState } from './FocusTimer'
import {
  currentStreak,
  loadSettings,
  mondayOf,
  monthOf,
  saveSettings,
  toDateKey,
} from './storage'
import { Settings } from './types'

type Tab = 'day' | 'week' | 'month' | 'year' | 'history'

export default function App() {
  const todayKey = toDateKey(new Date())
  const [tab, setTab] = useState<Tab>('day')
  const [dateKey, setDateKey] = useState(todayKey)
  const [mondayKey, setMondayKey] = useState(() => mondayOf(todayKey))
  const [monthKey, setMonthKey] = useState(() => monthOf(todayKey))
  const [yearNum, setYearNum] = useState(() => Number(todayKey.slice(0, 4)))
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [timer, setTimer] = useState<TimerState | null>(null)
  const sessionSink = useRef<((taskIndex: number) => void) | null>(null)

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
    })
  }

  const registerSessionSink = useCallback((fn: (taskIndex: number) => void) => {
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

  const goCloudLogin = () => {
    setTab('history')
    setTimeout(() => document.getElementById('cloud-sync')?.scrollIntoView({ behavior: 'smooth' }), 150)
  }

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
            本週
          </button>
          <button className={tab === 'month' ? 'active' : ''} onClick={() => setTab('month')}>
            本月
          </button>
          <button className={tab === 'year' ? 'active' : ''} onClick={() => setTab('year')}>
            年
          </button>
          <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
            回顧
          </button>
        </nav>
        <span className="streak">
          {cloudEnabled() && (
            <button
              className={`cloud-badge ${cloudIn ? 'on' : ''}`}
              onClick={goCloudLogin}
              title={cloudIn ? '雲端同步中，點擊管理' : '登入帳號，啟用全裝置自動同步'}
            >
              {cloudIn ? '☁ 同步中' : '☁ 登入'}
            </button>
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
          onOpenDay={(k) => {
            setDateKey(k)
            setTab('day')
          }}
        />
      )}
      {tab === 'year' && (
        <YearView
          year={yearNum}
          onYearChange={setYearNum}
          onOpenDay={(k) => {
            setDateKey(k)
            setTab('day')
          }}
        />
      )}
      {tab === 'history' && (
        <HistoryView
          onOpenDay={(k) => {
            setDateKey(k)
            setTab('day')
          }}
          settings={settings}
          onSettingsChange={updateSettings}
        />
      )}

      {timer && (
        <FocusTimer
          timer={timer}
          onUpdate={setTimer}
          breakMinutes={settings.breakMinutes}
          onSessionDone={(taskIndex) => sessionSink.current?.(taskIndex)}
        />
      )}
    </>
  )
}
