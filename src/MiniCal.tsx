// 無印式迷你月曆：大數字月份＋MTWTFSS＋可點日期；可高亮一週或單日
import { addDays, isoWeekOf, toDateKey } from './storage'

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

interface Props {
  year: number
  month: number // 1-12
  /** 高亮整週（該週週一的 dateKey） */
  weekOf?: string
  /** 高亮單日 */
  selectedDay?: string
  onPick: (dateKey: string) => void
  /** 微型尺寸（年曆列用） */
  micro?: boolean
  /** 點月份標題 */
  onPickMonth?: () => void
  /** 此月為目前檢視月 */
  current?: boolean
}

export default function MiniCal({ year, month, weekOf, selectedDay, onPick, micro, onPickMonth, current }: Props) {
  const daysInMonth = new Date(year, month, 0).getDate()
  const firstOffset = (new Date(year, month - 1, 1).getDay() + 6) % 7 // 週一起
  const todayKey = toDateKey(new Date())
  const weekDays = weekOf ? new Set(Array.from({ length: 7 }, (_, i) => addDays(weekOf, i))) : null

  const cells: (number | null)[] = [
    ...Array.from({ length: firstOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: (number | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  return (
    <div className={`mc ${micro ? 'mc-micro' : ''} ${current ? 'mc-cur' : ''}`}>
      <button className="mc-month" onClick={onPickMonth} disabled={!onPickMonth}>
        {month}
      </button>
      <div className="mc-grid">
        <span className="mc-wk" />
        {DOW.map((w, i) => (
          <span key={`h${i}`} className="mc-dow">
            {w}
          </span>
        ))}
        {weeks.map((row, r) => {
          const mondayOfRow = new Date(year, month - 1, 1 + r * 7 - firstOffset)
          return [
            <span key={`w${r}`} className="mc-wk">
              {isoWeekOf(mondayOfRow)}
            </span>,
            ...row.map((d, i) => {
              if (d === null) return <span key={`${r}-${i}`} className="mc-day blank" />
              const k = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
              const inWeek = weekDays?.has(k)
              const isSel = selectedDay === k
              const isToday = k === todayKey
              return (
                <button
                  key={`${r}-${i}`}
                  className={`mc-day ${inWeek ? 'in-week' : ''} ${isSel ? 'sel' : ''} ${isToday ? 'today' : ''}`}
                  onClick={() => onPick(k)}
                >
                  {d}
                </button>
              )
            }),
          ]
        })}
      </div>
    </div>
  )
}
