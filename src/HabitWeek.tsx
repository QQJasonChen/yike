import { useState } from 'react'
import { useStoredEntry } from './useStoredEntry'
import { TextField } from './fields'
import HabitHeatmap from './HabitHeatmap'
import { addDays, loadDay, saveDay, toDateKey } from './storage'
import { DayEntry, Settings } from './types'

// 一週檢視：習慣 × 7 天勾選表 + 近半年熱力圖
const WD = ['一', '二', '三', '四', '五', '六', '日']

interface Props {
  mondayKey: string
  settings: Settings
  onSettingsChange: (s: Settings) => void
}

export default function HabitWeek({ mondayKey, settings, onSettingsChange }: Props) {
  const [newHabit, setNewHabit] = useState('')
  const todayKey = toDateKey(new Date())
  const dayKeys = Array.from({ length: 7 }, (_, i) => addDays(mondayKey, i))

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
                      <HabitCheck dayKey={k} habit={h} />
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
          <TextField
            value={newHabit}
            placeholder="新增習慣（例如：運動、閱讀、冥想）"
            onValue={setNewHabit}
            onKeyDown={(e) => e.key === 'Enter' && addHabit()}
          />
        </div>
        <button className="rollover-btn" onClick={addHabit} disabled={!newHabit.trim()}>
          ＋ 新增
        </button>
      </div>

      {settings.habits.length > 0 && (
        <>
          <div className="label" style={{ marginTop: 22 }}>
            習慣熱力圖 <span className="hint">近一季・一格一天・愈深愈完整</span>
          </div>
          <HabitHeatmap endMonday={mondayKey} weeks={13} habits={settings.habits} />
        </>
      )}
    </div>
  )
}

function HabitCheck({ dayKey, habit }: { dayKey: string; habit: string }) {
  const { entry, edit } = useStoredEntry<DayEntry>(`pp:day:${dayKey}`, () => loadDay(dayKey), (value) => saveDay(dayKey, value))
  return <button className={`hw-check ${entry.habitsDone[habit] ? 'on' : ''}`}
    onClick={() => edit((base) => ({ ...base, habitsDone: { ...base.habitsDone, [habit]: !base.habitsDone[habit] } }))}>✓</button>
}
