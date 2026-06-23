import { useEffect, useMemo, useRef, useState } from 'react'
import MiniCal from './MiniCal'
import TaskRow from './TaskRow'
import Timeline from './Timeline'
import { TimerState } from './FocusTimer'
import { quoteForDate } from './quotes'
import { TextField } from './fields'
import { dayToMarkdown } from './exportMd'
import { spanToCells } from './Gantt'
import { ink } from './ink'
import { addDays, fromDateKey, loadDay, loadWeek, mondayOf, saveDay, toDateKey } from './storage'
import { DayEntry, Settings, Task } from './types'

const WEEKDAYS_EN = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']

/** ISO 週數＋週內日序（週一 .1 → 週日 .7），例：W24.7 */
const weekDecimal = (d: Date): string => {
  const dow = (d.getDay() + 6) % 7 // Mon=0..Sun=6
  const monday = new Date(d)
  monday.setDate(d.getDate() - dow)
  const jan4 = new Date(monday.getFullYear(), 0, 4)
  const jan4Mon = new Date(jan4)
  jan4Mon.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7))
  // 用「天數四捨五入」避免日光節約時間的 1 小時誤差
  let week = Math.round((monday.getTime() - jan4Mon.getTime()) / 86400000) / 7 + 1
  if (week < 1) week = 52
  return `W${week}.${dow + 1}`
}
const MOODS = ['😖', '🙁', '😐', '🙂', '😄']

interface Props {
  dateKey: string
  onDateChange: (key: string) => void
  timer: TimerState | null
  onStartFocus: (taskIndex: number, taskText: string) => void
  settings: Settings
  onSettingsChange: (s: Settings) => void
  /** 計時器完成一個時段時，由 App 呼叫塗圈 */
  registerSessionSink: (fn: (taskIndex: number, startMs: number, endMs: number) => void) => void
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
  const [inkOk, setInkOk] = useState(false) // iPad 才有手寫
  useEffect(() => {
    ink.available().then(setInkOk)
  }, [])
  // 今天的週計畫：本週甘特裡有排到「今天」的任務（每日提醒該推進什麼）
  const todayPlanTasks = useMemo(() => {
    const we = loadWeek(mondayOf(dateKey))
    const wd = (fromDateKey(dateKey).getDay() + 6) % 7 // 一=0 … 日=6
    return we.tasks
      .filter((t) => t.text.trim() && (t.cells ?? spanToCells(t.span)).includes(wd))
      .map((t) => t.text.trim())
  }, [dateKey])
  const [rolloverDone, setRolloverDone] = useState(false)
  // 今日時間軸：手機預設收起（桌機永遠展開、不顯示切換鈕）
  const [showTimeline, setShowTimeline] = useState(
    () => !(typeof window !== 'undefined' && window.matchMedia('(max-width: 560px)').matches)
  )
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
  const taskListRef = useRef<HTMLDivElement>(null)

  const focusNextTask = (currentIndex: number) => {
    const inputs = taskListRef.current?.querySelectorAll<HTMLInputElement>('input[list="yike-names"]')
    inputs?.[currentIndex + 1]?.focus()
  }

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

  const openInk = async () => {
    const r = await ink.edit(entry.ink?.drawing)
    if (!r) return // 取消
    update({ ink: r.png ? r : undefined }) // 清空（png 空）就移除
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

  // Focus Timer 完成時段 → 塗圈 ＋ 把真實時段自動寫進右邊時間軸
  useEffect(() => {
    registerSessionSink((taskIndex, startMs, endMs) => {
      setEntry((prev) => {
        const tasks = prev.tasks.slice()
        const t = tasks[taskIndex]
        if (t) {
          const done = Math.min(t.done + 1, 8)
          tasks[taskIndex] = { ...t, done, actual: done }
        }
        // 真實起訖 → 分鐘（夾在時間軸 06:00–23:00 範圍內，最短 15 分鐘）
        const toMin = (ms: number) => {
          const dd = new Date(ms)
          return dd.getHours() * 60 + dd.getMinutes()
        }
        const bStart = Math.max(6 * 60, Math.min(23 * 60 - 15, toMin(startMs)))
        const bEnd = Math.max(bStart + 15, Math.min(23 * 60, toMin(endMs)))
        const blocks = prev.blocks.slice()
        // 同任務、上一塊結尾相距 ≤6 分鐘 → 直接接長（連續番茄變一條）
        const tail = blocks
          .filter((b) => b.taskIndex === taskIndex)
          .sort((x, y) => y.end - x.end)[0]
        if (tail && Math.abs(bStart - tail.end) <= 6) {
          tail.end = bEnd
        } else {
          blocks.push({
            id: `f${Date.now().toString(36)}`,
            start: bStart,
            end: bEnd,
            text: t?.text ?? '專注',
            taskIndex,
          })
        }
        const next = { ...prev, tasks, blocks }
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
              <span className="week-no">・{weekDecimal(d)}</span>
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

        {todayPlanTasks.length > 0 && (
          <div className="today-plan">
            <span className="tp-label">📌 今天的週計畫</span>
            {todayPlanTasks.map((t, i) => (
              <span key={i} className="tp-chip">
                {t}
              </span>
            ))}
          </div>
        )}

        <div className="day-grid">
          <div>
            {settings.morningQs.map((q, i) => (
              <span key={`m${i}`}>
                <div className="label" style={i === 0 ? { marginTop: 0 } : undefined}>
                  {q}
                </div>
                <div className="line-input">
                  <TextField
                    value={entry.answers[`m${i}`] ?? ''}
                    onValue={(v) => setAnswer(`m${i}`, v)}
                    placeholder={MORNING_PLACEHOLDERS[i] ?? ''}
                  />
                </div>
              </span>
            ))}

            {settings.showRollover && !rolloverDone && yesterdayUnfinished.length > 0 && (
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

            <div ref={taskListRef}>
            {entry.tasks.map((t, i) => (
              <span key={i}>
                {sectionLabel(i)}
                <TaskRow
                  index={i}
                  task={t}
                  onChange={(nt) => updateTask(i, nt)}
                  isRunning={timer?.phase === 'focus' && timer.taskIndex === i && isToday}
                  onStartFocus={() => onStartFocus(i, t.text)}
                  onEnterKey={() => focusNextTask(i)}
                  onDropToTimeline={(x, y) => {
                    const landed = dropRef.current?.(x, y, t.text, i)
                    if (!landed && t.text.trim()) {
                      // 沒掉在時間軸上（手機時間軸在下方搆不到）→ 自動排進下一個空檔
                      const now = new Date()
                      const nowMin = now.getHours() * 60 + now.getMinutes()
                      const dur = Math.min(120, 30 * Math.max(1, (t.target ?? 1) - t.done))
                      let start = Math.max(6 * 60, Math.ceil(nowMin / 30) * 30)
                      const blocks = entry.blocks
                      const overlaps = (s0: number, e0: number) =>
                        blocks.some((b) => s0 < b.end && e0 > b.start)
                      while (start + dur <= 23 * 60 && overlaps(start, start + dur)) start += 30
                      if (start + dur > 23 * 60) start = Math.max(6 * 60, 23 * 60 - dur)
                      update({
                        blocks: [
                          ...blocks,
                          {
                            id: `a${Date.now().toString(36)}`,
                            start,
                            end: start + dur,
                            text: t.text,
                            taskIndex: i,
                          },
                        ],
                      })
                    }
                  }}
                />
                {i === 0 && isToday && t.text.trim() && !t.completed && !timer && (
                  <div className="mit-focus-row">
                    <button
                      className="mit-focus"
                      onClick={() => onStartFocus(0, t.text)}
                      title="開始專注（番茄鐘）"
                      aria-label="開始專注"
                    >
                      <svg className="mit-tomato" viewBox="0 0 32 32" aria-hidden="true">
                        {/* 葉冠 */}
                        <path
                          d="M16 4 L17.3 7.2 L20.8 7.5 L18.1 9.7 L18.9 13 L16 11.2 L13.1 13 L13.9 9.7 L11.2 7.5 L14.7 7.2 Z"
                          fill="#6aa345"
                        />
                        <rect x="15.2" y="2.4" width="1.6" height="3.4" rx="0.8" fill="#4a7a30" />
                        {/* 果身 */}
                        <ellipse cx="16" cy="19.5" rx="10.5" ry="9.6" fill="#e2503a" />
                        <path
                          d="M16 10.2c4.6 0 8.4 3.5 9.3 8-2.6.9-6 1.4-9.3 1.4s-6.7-.5-9.3-1.4c.9-4.5 4.7-8 9.3-8z"
                          fill="#ec6347"
                        />
                        {/* 反光 */}
                        <ellipse cx="11.6" cy="16" rx="2.6" ry="1.7" fill="#fff" opacity="0.5" />
                      </svg>
                    </button>
                    <select
                      className="mit-len"
                      value={settings.focusMinutes}
                      title="一段專注的長度（會記住）"
                      onChange={(e) =>
                        onSettingsChange({ ...settings, focusMinutes: Number(e.target.value) })
                      }
                    >
                      {[15, 20, 25, 30, 35, 40, 45, 50].map((m) => (
                        <option key={m} value={m}>
                          {m} 分
                        </option>
                      ))}
                    </select>
                    <span className="mit-focus-sub">
                      結束自動刻一筆{t.target ? `・目標 ${t.target}` : ''}
                    </span>
                  </div>
                )}
              </span>
            ))}
            </div>

            {settings.eveningQs.map((q, i) => (
              <span key={`e${i}`}>
                <div className="label">{q}</div>
                <div className="line-input">
                  <TextField
                    value={entry.answers[`e${i}`] ?? ''}
                    onValue={(v) => setAnswer(`e${i}`, v)}
                    placeholder={i === 0 ? '今天最棒的時刻⋯' : ''}
                  />
                </div>
              </span>
            ))}

            {inkOk && (
              <div className="ink-note">
                <div className="label">
                  手寫便箋 <span className="hint">用 Apple Pencil 在這寫字、塗鴉</span>
                </div>
                <button className="ink-pad" onClick={openInk}>
                  {entry.ink?.png ? (
                    <img src={`data:image/png;base64,${entry.ink.png}`} alt="手寫便箋" />
                  ) : (
                    <span className="ink-empty">✍️ 點一下，用 Apple Pencil 手寫</span>
                  )}
                </button>
              </div>
            )}

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
                  <TextField
                    autoFocus
                    className="habit-add-input"
                    placeholder="習慣名稱，Enter 確認"
                    value={newHabit}
                    onValue={setNewHabit}
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
                <div className="eval-group" title="今天的生產力／滿意度 1-5 分">
                  <span className="eval-label">生產力</span>
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

          <div className="day-side">
            <MiniCal
              year={d.getFullYear()}
              month={d.getMonth() + 1}
              selectedDay={dateKey}
              onPick={onDateChange}
            />
            <button
              className="wk-grid-toggle day-tl-toggle"
              onClick={() => setShowTimeline((v) => !v)}
            >
              <span className="g-caret">{showTimeline ? '▾' : '▸'}</span>
              今日時間軸
              <span className="hint">{showTimeline ? '' : '點開排時間'}</span>
            </button>
            {showTimeline && (
              <Timeline
                blocks={entry.blocks}
                isToday={isToday}
                routines={settings.routines}
                onChange={(blocks) => update({ blocks })}
                onRoutinesChange={(routines) => onSettingsChange({ ...settings, routines })}
                dropRef={dropRef}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
