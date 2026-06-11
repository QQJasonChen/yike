import { useEffect, useRef, useState } from 'react'
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
  const todayKey = toDateKey(new Date())

  const copyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(dayToMarkdown(dateKey, entry))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      alert('複製失敗，請改用「回顧」頁的匯出 JSON')
    }
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
            <div className="label" style={{ marginTop: 0 }}>
              我感謝
            </div>
            <div className="line-input">
              <input
                value={entry.gratitude}
                onChange={(e) => update({ gratitude: e.target.value })}
                placeholder="今天想感謝的人事物⋯"
              />
            </div>

            <div className="label">今日意圖</div>
            <div className="line-input">
              <input
                value={entry.intention}
                onChange={(e) => update({ intention: e.target.value })}
                placeholder="今天想以什麼狀態度過？例：平靜地高效"
              />
            </div>

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
              </span>
            ))}

            <div className="label">今日亮點</div>
            <div className="line-input">
              <input
                value={entry.highlight}
                onChange={(e) => update({ highlight: e.target.value })}
                placeholder="今天最棒的時刻⋯"
              />
            </div>

            <div className="label">我今天學到了什麼？</div>
            <div className="line-input">
              <input
                value={entry.learned}
                onChange={(e) => update({ learned: e.target.value })}
              />
            </div>

            <div className="label">我想記住今天的什麼？</div>
            <div className="line-input">
              <input
                value={entry.remember}
                onChange={(e) => update({ remember: e.target.value })}
              />
            </div>

            <div className="eval-bar">
              <div className="eval-group" title="今日習慣">
                <span className="eval-label">習慣</span>
                <button
                  className={`habit-dot ${entry.habit ? 'on' : ''}`}
                  onClick={() => update({ habit: !entry.habit })}
                />
                <input
                  className="habit-name-input"
                  value={settings.habitName}
                  onChange={(e) => onSettingsChange({ ...settings, habitName: e.target.value })}
                  placeholder="習慣名稱"
                />
              </div>

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
