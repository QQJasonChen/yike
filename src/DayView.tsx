import { useEffect, useMemo, useRef, useState } from 'react'
import TaskRow from './TaskRow'
import Timeline from './Timeline'
import { TimerState } from './FocusTimer'
import { quoteForDate } from './quotes'
import { dayToMarkdown } from './exportMd'
import { addDays, loadDay, saveDay, toDateKey } from './storage'
import { DayEntry, Settings, Task } from './types'

const WEEKDAYS_EN = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']
const MOODS = ['😖', '🙁', '😐', '🙂', '😄']

interface Props {
  dateKey: string
  onDateChange: (key: string) => void
  timer: TimerState | null
  onStartFocus: (taskIndex: number, taskText: string) => void
  settings: Settings
  onSettingsChange: (s: Settings) => void
  /** 計時器完成一個時段時，由 App 呼叫塗圈 */
  registerSessionSink: (fn: (taskIndex: number) => void) => void
}

export default function DayView({
  dateKey,
  onDateChange,
  timer,
  onStartFocus,
  settings,
  onSettingsChange,
  registerSessionSink,
}: Props) {
  const [entry, setEntry] = useState<DayEntry>(() => loadDay(dateKey))
  const [copied, setCopied] = useState(false)
  const [rolloverDone, setRolloverDone] = useState(false)
  const [addingHabit, setAddingHabit] = useState(false)
  const [newHabit, setNewHabit] = useState('')

  const addHabit = () => {
    const name = newHabit.trim()
    if (name && !settings.habits.includes(name) && settings.habits.length < 8)
      onSettingsChange({ ...settings, habits: [...settings.habits, name] })
    setNewHabit('')
    setAddingHabit(false)
  }
  const todayKey = toDateKey(new Date())

  const copyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(
        dayToMarkdown(dateKey, entry, settings.morningQs, settings.eveningQs)
      )
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      alert('複製失敗，請改用「回顧」頁的匯出 JSON')
    }
  }

  // 昨日未完成任務 → 一鍵帶入今天
  const yesterdayUnfinished = useMemo(() => {
    if (dateKey !== todayKey) return []
    const prev = loadDay(addDays(dateKey, -1))
    const todayTexts = new Set(entry.tasks.map((t) => t.text.trim()).filter(Boolean))
    return prev.tasks.filter((t) => t.text.trim() && !t.completed && !todayTexts.has(t.text.trim()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey, todayKey, rolloverDone])

  const rollover = () => {
    setEntry((prev) => {
      const tasks = prev.tasks.slice()
      let qi = 0
      for (let i = 0; i < tasks.length && qi < yesterdayUnfinished.length; i++) {
        if (!tasks[i].text.trim()) {
          const src = yesterdayUnfinished[qi++]
          tasks[i] = { text: src.text, target: src.target, done: 0, actual: null, completed: false }
        }
      }
      const next = { ...prev, tasks }
      saveDay(dateKey, next)
      return next
    })
    setRolloverDone(true)
  }
  const isToday = dateKey === todayKey
  const dropRef = useRef<((x: number, y: number, text: string, taskIndex: number) => boolean) | null>(null)

  // 換日期時重新載入
  useEffect(() => {
    setEntry(loadDay(dateKey))
  }, [dateKey])

  // 任何修改即時存檔（零儲存按鈕）
  const update = (patch: Partial<DayEntry>) => {
    setEntry((prev) => {
      const next = { ...prev, ...patch }
      saveDay(dateKey, next)
      return next
    })
  }

  const updateTask = (i: number, t: Task) => {
    const tasks = entry.tasks.slice()
    tasks[i] = t
    update({ tasks })
  }

  const setAnswer = (id: string, v: string) =>
    update({ answers: { ...entry.answers, [id]: v } })

  const MORNING_PLACEHOLDERS: Record<number, string> = {
    0: '今天想感謝的人事物⋯',
    1: '用現在式宣告：例「我是一個說到做到的人」「我是冷靜出手的創作者」',
    2: '一個小實驗：例「最難的事排第一段專注」「先錄影再回訊息」',
  }

  // Focus Timer 完成時段 → 塗下一個圈（只對今天有效）
  useEffect(() => {
    registerSessionSink((taskIndex) => {
      setEntry((prev) => {
        const tasks = prev.tasks.slice()
        const t = tasks[taskIndex]
        if (t) {
          const done = Math.min(t.done + 1, 5)
          tasks[taskIndex] = { ...t, done, actual: done }
        }
        const next = { ...prev, tasks }
        saveDay(todayKey, next)
        return next
      })
    })
  }, [registerSessionSink, todayKey])

  const d = new Date(
    Number(dateKey.slice(0, 4)),
    Number(dateKey.slice(5, 7)) - 1,
    Number(dateKey.slice(8, 10))
  )
  const quote = quoteForDate(dateKey)

  const sectionLabel = (i: number) =>
    i === 0 ? (
      <div className="label" key={`l${i}`}>
        <span className="star">★</span> 最重要任務
        <span className="hint">最不舒服、最常拖延的那一件</span>
      </div>
    ) : i === 1 ? (
      <div className="label" key={`l${i}`}>
        次要任務 <span className="hint">完成它們會讓今天更好</span>
      </div>
    ) : i === 3 ? (
      <div className="label" key={`l${i}`}>
        額外任務 <span className="hint">先做完上面的再說</span>
      </div>
    ) : null

  return (
    <div className="page">
      <div className="page-inner">
        <div className="day-head">
          <div className="day-title">
            <span className="day-weekday">{WEEKDAYS_EN[d.getDay()]}</span>
            <span className="day-date">
              {d.getMonth() + 1} 月 {d.getDate()} 日 {d.getFullYear()}
            </span>
          </div>
          <div className="day-nav">
            <button
              className="today-btn"
              onClick={copyMarkdown}
              title="複製這一天的 Markdown，可直接貼到 Heptabase / Notion"
            >
              {copied ? '✓ 已複製' : '⧉ MD'}
            </button>
            <button onClick={() => onDateChange(addDays(dateKey, -1))} title="前一天">
              ‹
            </button>
            {!isToday && (
              <button className="today-btn" onClick={() => onDateChange(todayKey)}>
                回到今天
              </button>
            )}
            <button onClick={() => onDateChange(addDays(dateKey, 1))} title="後一天">
              ›
            </button>
          </div>
        </div>

        <div className="quote">
          「{quote.text}」<span className="author">— {quote.author}</span>
        </div>

        <div className="day-grid">
          <div>
            {settings.morningQs.map((q, i) => (
              <span key={`m${i}`}>
                <div className="label" style={i === 0 ? { marginTop: 0 } : undefined}>
                  {q}
                </div>
                <div className="line-input">
                  <input
                    value={entry.answers[`m${i}`] ?? ''}
                    onChange={(e) => setAnswer(`m${i}`, e.target.value)}
                    placeholder={MORNING_PLACEHOLDERS[i] ?? ''}
                  />
                </div>
              </span>
            ))}

            {yesterdayUnfinished.length > 0 && (
              <div className="rollover">
                <span>
                  昨天有 <b>{yesterdayUnfinished.length}</b> 件未完成：
                  {yesterdayUnfinished.map((t) => t.text).join('、').slice(0, 40)}
                </span>
                <span>
                  <button className="rollover-btn" onClick={rollover}>
                    帶入今天 →
                  </button>
                  <button className="rollover-dismiss" onClick={() => setRolloverDone(true)} title="忽略">
                    ✕
                  </button>
                </span>
              </div>
            )}

            {entry.tasks.map((t, i) => (
              <span key={i}>
                {sectionLabel(i)}
                <TaskRow
                  index={i}
                  task={t}
                  onChange={(nt) => updateTask(i, nt)}
                  isRunning={timer?.phase === 'focus' && timer.taskIndex === i && isToday}
                  onStartFocus={() => onStartFocus(i, t.text)}
                  onDropToTimeline={(x, y) => {
                    dropRef.current?.(x, y, t.text, i)
                  }}
                />
                {i === 0 && isToday && t.text.trim() && !t.completed && !timer && (
                  <button className="mit-focus" onClick={() => onStartFocus(0, t.text)}>
                    <span className="mit-focus-ring">▶</span>
                    開始一段專注（{settings.focusMinutes} 分鐘）
                    <span className="mit-focus-sub">
                      倒數結束自動塗一圈{t.target ? `・目標 ${t.target} 圈` : ''}
                    </span>
                  </button>
                )}
              </span>
            ))}

            {settings.eveningQs.map((q, i) => (
              <span key={`e${i}`}>
                <div className="label">{q}</div>
                <div className="line-input">
                  <input
                    value={entry.answers[`e${i}`] ?? ''}
                    onChange={(e) => setAnswer(`e${i}`, e.target.value)}
                    placeholder={i === 0 ? '今天最棒的時刻⋯' : ''}
                  />
                </div>
              </span>
            ))}

            <div className="eval-bar">
              <div className="eval-row habits-row">
                <span className="eval-label">習慣</span>
                {settings.habits.map((h) => (
                  <button
                    key={h}
                    className={`habit-chip ${entry.habitsDone[h] ? 'on' : ''}`}
                    onClick={() =>
                      update({ habitsDone: { ...entry.habitsDone, [h]: !entry.habitsDone[h] } })
                    }
                  >
                    {entry.habitsDone[h] ? '✓ ' : ''}
                    {h}
                  </button>
                ))}
                {addingHabit ? (
                  <input
                    autoFocus
                    className="habit-add-input"
                    placeholder="習慣名稱，Enter 確認"
                    value={newHabit}
                    onChange={(e) => setNewHabit(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addHabit()}
                    onBlur={addHabit}
                  />
                ) : (
                  settings.habits.length < 8 && (
                    <button className="habit-chip ghost" onClick={() => setAddingHabit(true)}>
                      ＋ 新增
                    </button>
                  )
                )}
              </div>
              <div className="eval-row">
                <div className="eval-group" title="今日心情">
                  <span className="eval-label">心情</span>
                  {MOODS.map((m, i) => (
                    <button
                      key={i}
                      className={`mood-btn ${entry.mood === i + 1 ? 'on' : ''}`}
                      onClick={() => update({ mood: entry.mood === i + 1 ? null : i + 1 })}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <div className="eval-group" title="今天的生產力 1-5 分">
                  <span className="eval-label">評分</span>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      className={`score-btn ${entry.score === n ? 'on celebrate' : ''}`}
                      onClick={() => update({ score: entry.score === n ? null : n })}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <Timeline
            blocks={entry.blocks}
            isToday={isToday}
            onChange={(blocks) => update({ blocks })}
            dropRef={dropRef}
          />
        </div>
      </div>
    </div>
  )
}
