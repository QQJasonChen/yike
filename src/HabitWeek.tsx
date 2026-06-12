import { useEffect, useMemo, useState } from 'react'
import { addDays, allDayKeys, loadDay, saveDay, toDateKey } from './storage'
import { DayEntry, Settings } from './types'

// 一週檢視：習慣 × 7 天勾選表 + 近半年熱力圖
const WD = ['一', '二', '三', '四', '五', '六', '日']

interface Props {
  mondayKey: string
  settings: Settings
  onSettingsChange: (s: Settings) => void
}

export default function HabitWeek({ mondayKey, settings, onSettingsChange }: Props) {
  const [entries, setEntries] = useState<Record<string, DayEntry>>({})
  const [newHabit, setNewHabit] = useState('')
  const todayKey = toDateKey(new Date())
  const dayKeys = Array.from({ length: 7 }, (_, i) => addDays(mondayKey, i))

  useEffect(() => {
    const map: Record<string, DayEntry> = {}
    for (const k of dayKeys) map[k] = loadDay(k)
    setEntries(map)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mondayKey])

  const toggle = (dayKey: string, habit: string) => {
    setEntries((prev) => {
      const entry = prev[dayKey] ?? loadDay(dayKey)
      const next = {
        ...entry,
        habitsDone: { ...entry.habitsDone, [habit]: !entry.habitsDone[habit] },
      }
      saveDay(dayKey, next)
      return { ...prev, [dayKey]: next }
    })
  }

  const addHabit = () => {
    const name = newHabit.trim()
    if (!name || settings.habits.includes(name) || settings.habits.length >= 8) return
    onSettingsChange({ ...settings, habits: [...settings.habits, name] })
    setNewHabit('')
  }

  const removeHabit = (name: string) => {
    if (!confirm(`移除習慣「${name}」？（過去的打勾記錄會保留在資料裡）`)) return
    onSettingsChange({ ...settings, habits: settings.habits.filter((h) => h !== name) })
  }

  // 近半年熱力圖：每天完成數 / 習慣數
  const heat = useMemo(() => {
    if (settings.habits.length === 0) return []
    const recorded = new Set(allDayKeys())
    // 從 25 週前的週一開始，到本週日，按欄（週）排
    const start = addDays(mondayKey, -25 * 7)
    const weeks: { key: string; ratio: number | null }[][] = []
    for (let w = 0; w < 26; w++) {
      const col: { key: string; ratio: number | null }[] = []
      for (let d = 0; d < 7; d++) {
        const k = addDays(start, w * 7 + d)
        if (!recorded.has(k)) {
          col.push({ key: k, ratio: null })
        } else {
          const e = loadDay(k)
          const done = settings.habits.filter((h) => e.habitsDone[h]).length
          col.push({ key: k, ratio: done / settings.habits.length })
        }
      }
      weeks.push(col)
    }
    return weeks
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mondayKey, settings.habits, entries])

  return (
    <div className="hw">
      <div className="label">
        一週檢視 <span className="hint">習慣，每天一格</span>
      </div>
      {settings.habits.length > 0 && (
        <div className="hw-scroll">
          <table className="hw-table">
            <thead>
              <tr>
                <th className="hw-name-col">習慣</th>
                {dayKeys.map((k, i) => (
                  <th key={k} className={k === todayKey ? 'today' : ''}>
                    週{WD[i]}
                    <span className="hw-date">
                      {Number(k.slice(5, 7))}/{Number(k.slice(8, 10))}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {settings.habits.map((h) => (
                <tr key={h}>
                  <td className="hw-name-col">
                    {h}
                    <button className="hw-del" title="移除習慣" onClick={() => removeHabit(h)}>
                      ✕
                    </button>
                  </td>
                  {dayKeys.map((k) => (
                    <td key={k} className={k === todayKey ? 'today' : ''}>
                      <button
                        className={`hw-check ${entries[k]?.habitsDone[h] ? 'on' : ''}`}
                        onClick={() => toggle(k, h)}
                      >
                        ✓
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="hw-add">
        <div className="line-input" style={{ flex: 1 }}>
          <input
            value={newHabit}
            placeholder="新增習慣（例如：運動、閱讀、冥想）"
            onChange={(e) => setNewHabit(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addHabit()}
          />
        </div>
        <button className="rollover-btn" onClick={addHabit} disabled={!newHabit.trim()}>
          ＋ 新增
        </button>
      </div>

      {settings.habits.length > 0 && heat.length > 0 && (
        <>
          <div className="label" style={{ marginTop: 22 }}>
            習慣熱力圖 <span className="hint">近半年・一格一天・愈深愈完整</span>
          </div>
          <div className="hw-heat-scroll">
            <div className="hw-heat">
              {heat.map((col, wi) => (
                <div key={wi} className="hw-heat-col">
                  {col.map((c) => (
                    <span
                      key={c.key}
                      className={`hw-heat-cell ${
                        c.ratio === null ? 'none' : `h${Math.ceil(c.ratio * 4)}`
                      } ${c.key === todayKey ? 'today' : ''}`}
                      title={`${c.key.slice(5).replace('-', '/')}${
                        c.ratio !== null ? `：${Math.round(c.ratio * 100)}%` : ''
                      }`}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
