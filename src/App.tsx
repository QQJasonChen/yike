import { useCallback, useRef, useState } from 'react'
import DayView from './DayView'
import WeekView from './WeekView'
import HistoryView from './HistoryView'
import FocusTimer, { TimerState } from './FocusTimer'
import {
  currentStreak,
  loadSettings,
  mondayOf,
  saveSettings,
  toDateKey,
} from './storage'
import { Settings } from './types'

type Tab = 'day' | 'week' | 'history'

export default function App() {
  const todayKey = toDateKey(new Date())
  const [tab, setTab] = useState<Tab>('day')
  const [dateKey, setDateKey] = useState(todayKey)
  const [mondayKey, setMondayKey] = useState(() => mondayOf(todayKey))
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

  const streak = currentStreak(todayKey)

  return (
    <>
      <div className="topbar">
        <span className="brand">The Productivity Planner</span>
        <nav className="tabs">
          <button className={tab === 'day' ? 'active' : ''} onClick={() => setTab('day')}>
            今天
          </button>
          <button className={tab === 'week' ? 'active' : ''} onClick={() => setTab('week')}>
            本週
          </button>
          <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
            回顧
          </button>
        </nav>
        <span className="streak">
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
