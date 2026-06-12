// 無印式迷你月曆：大數字月份＋MTWTFSS＋可點日期；可高亮一週或單日
import { addDays, toDateKey } from './storage'

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

interface Props {
  year: number
  month: number // 1-12
  /** 高亮整週（該週週一的 dateKey） */
  weekOf?: string
  /** 高亮單日 */
  selectedDay?: string
  onPick: (dateKey: string) => void
}

export default function MiniCal({ year, month, weekOf, selectedDay, onPick }: Props) {
  const daysInMonth = new Date(year, month, 0).getDate()
  const firstOffset = (new Date(year, month - 1, 1).getDay() + 6) % 7 // 週一起
  const todayKey = toDateKey(new Date())
  const weekDays = weekOf ? new Set(Array.from({ length: 7 }, (_, i) => addDays(weekOf, i))) : null

  const cells: (number | null)[] = [
    ...Array.from({ length: firstOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className="mc">
      <div className="mc-month">{month}</div>
      <div className="mc-grid">
        {DOW.map((w, i) => (
          <span key={`h${i}`} className="mc-dow">
            {w}
          </span>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <span key={i} className="mc-day blank" />
          const k = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
          const inWeek = weekDays?.has(k)
          const isSel = selectedDay === k
          const isToday = k === todayKey
          return (
            <button
              key={i}
              className={`mc-day ${inWeek ? 'in-week' : ''} ${isSel ? 'sel' : ''} ${isToday ? 'today' : ''}`}
              onClick={() => onPick(k)}
            >
              {d}
            </button>
          )
        })}
      </div>
    </div>
  )
}
