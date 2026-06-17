import { useMemo } from 'react'
import { addDays, allDayKeys, loadDay, toDateKey } from './storage'

// GitHub 式習慣熱力圖。範圍可調（weeks），給不同視圖用不同尺度。
interface Props {
  endMonday: string // 最後一欄（週）的週一日期
  weeks: number // 顯示幾週
  habits: string[]
}

export default function HabitHeatmap({ endMonday, weeks, habits }: Props) {
  const todayKey = toDateKey(new Date())

  const heat = useMemo(() => {
    if (habits.length === 0) return []
    const recorded = new Set(allDayKeys())
    const start = addDays(endMonday, -(weeks - 1) * 7)
    const cols: { key: string; ratio: number | null }[][] = []
    for (let w = 0; w < weeks; w++) {
      const col: { key: string; ratio: number | null }[] = []
      for (let d = 0; d < 7; d++) {
        const k = addDays(start, w * 7 + d)
        if (!recorded.has(k)) {
          col.push({ key: k, ratio: null })
        } else {
          const e = loadDay(k)
          const done = habits.filter((h) => e.habitsDone[h]).length
          col.push({ key: k, ratio: done / habits.length })
        }
      }
      cols.push(col)
    }
    return cols
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endMonday, weeks, habits])

  if (habits.length === 0 || heat.length === 0) return null

  return (
    <div className="hw-heat-scroll">
      <div className="hw-heat-wrap">
        <div className="hw-heat-months">
          {heat.map((col, wi) => {
            const m = Number(col[0].key.slice(5, 7))
            const prev = wi > 0 ? Number(heat[wi - 1][0].key.slice(5, 7)) : 0
            return (
              <span key={wi} className="hw-heat-month">
                {m !== prev ? `${m}月` : ''}
              </span>
            )
          })}
        </div>
        <div className="hw-heat-body">
          <div className="hw-heat-days">
            <span>一</span>
            <span />
            <span>三</span>
            <span />
            <span>五</span>
            <span />
            <span />
          </div>
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
                      c.ratio !== null
                        ? `：完成 ${Math.round(c.ratio * habits.length)}/${habits.length} 個習慣`
                        : '（未記錄）'
                    }`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="hw-heat-legend">
          <span>少</span>
          <span className="hw-heat-cell none" />
          <span className="hw-heat-cell h1" />
          <span className="hw-heat-cell h2" />
          <span className="hw-heat-cell h3" />
          <span className="hw-heat-cell h4" />
          <span>多</span>
        </div>
      </div>
    </div>
  )
}
