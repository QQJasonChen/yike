import { useEffect, useState } from 'react'
import Gantt from './Gantt'
import { loadLife, saveLife } from './storage'
import { LifeEntry } from './types'

// 願景：一頁看見長遠的方向（北極星 + 十年甘特 + 奧德賽三條路）
const HORIZON = 10 // 甘特顯示幾年

export default function LifeView() {
  const [entry, setEntry] = useState<LifeEntry>(loadLife)
  const thisYear = new Date().getFullYear()

  // 換頁回來時重新讀（雲端同步可能拉到新資料）
  useEffect(() => {
    setEntry(loadLife())
  }, [])

  const update = (patch: Partial<LifeEntry>) => {
    setEntry((prev) => {
      const next = { ...prev, ...patch }
      saveLife(next)
      return next
    })
  }

  const setGoal = (i: number, patch: Partial<LifeEntry['goals'][number]>) => {
    const goals = entry.goals.slice()
    goals[i] = { ...goals[i], ...patch }
    update({ goals })
  }

  const setPath = (i: number, patch: Partial<LifeEntry['odyssey'][number]>) => {
    const odyssey = entry.odyssey.slice()
    odyssey[i] = { ...odyssey[i], ...patch }
    update({ odyssey })
  }

  const start = entry.startYear || thisYear

  return (
    <div className="page">
      <div className="page-inner">
        <h2 className="section-title">願景</h2>
        <p className="section-sub">Vision — 先看見遠方的樣子，再走好今天的每一步。</p>

        {/* 北極星：願景的方向 */}
        <div className="label">北極星 · 你想去的方向</div>
        <div className="northstar-box">
          <span className="northstar-star">✦</span>
          <textarea
            className="northstar-input"
            rows={2}
            placeholder="我想成為什麼樣的人？想去哪裡？（寫一句就好，當作所有選擇的北極星）"
            value={entry.northStar}
            onChange={(e) => update({ northStar: e.target.value })}
          />
        </div>

        {/* 願景大目標 */}
        <div className="label">想完成的大事</div>
        {entry.goals.map((g, i) => (
          <div key={i} className={`week-task-row ${g.done ? 'done' : ''}`}>
            <span className="task-num">{i + 1}.</span>
            <input
              list="yike-names"
              value={g.text}
              placeholder={i === 0 ? '如果這十年只完成一件，你會選哪一件？' : ''}
              onChange={(e) => setGoal(i, { text: e.target.value })}
            />
            <button
              className={`week-check ${g.done ? 'on' : ''}`}
              onClick={() => setGoal(i, { done: !g.done })}
              title="完成"
            >
              ✓
            </button>
          </div>
        ))}

        {/* 十年甘特：把每個目標拖到它該發生的年份 */}
        <Gantt
          title="十年甘特"
          hint="在目標的列上拖出起訖年・雙擊清除"
          emptyHint="先寫下想完成的大事，這裡就會出現可拖拉的十年時程"
          cols={Array.from({ length: HORIZON }, (_, i) => ({
            label: `'${String((start + i) % 100).padStart(2, '0')}`,
            sub: i === 4 ? '五年' : i === 9 ? '十年' : undefined,
            today: start + i === thisYear,
            active: i === 4 || i === 9,
          }))}
          rows={entry.goals
            .map((g, i) => ({ ...g, i }))
            .filter((g) => g.text.trim())}
          onSpan={(i, span) => setGoal(i, { span })}
        />

        {/* 奧德賽計畫：三個五年後的我 */}
        <div
          className="label odyssey-head"
          onClick={() => update({ odysseyOpen: !entry.odysseyOpen })}
          title="展開／收合"
        >
          <span className={`odyssey-caret ${entry.odysseyOpen ? 'open' : ''}`}>▸</span>
          奧德賽計畫 — 三個五年後的我
          <span className="hint">同一個你，三條都走得通的路。興奮度幫你看出真正想要的。</span>
        </div>

        {entry.odysseyOpen && (
          <div className="odyssey-grid">
            {entry.odyssey.map((p, i) => (
              <div key={i} className="odyssey-card">
                <input
                  className="odyssey-title"
                  value={p.title}
                  placeholder={['現在這條路', '如果它消失了', '不管錢與面子'][i]}
                  onChange={(e) => setPath(i, { title: e.target.value })}
                />
                <textarea
                  className="odyssey-body"
                  rows={6}
                  placeholder={
                    [
                      '沿著現在的路走五年，會走到哪？',
                      '如果現在這條路突然不能走了，你會做什麼？',
                      '如果錢和別人的眼光都不是問題，你會過怎樣的五年？',
                    ][i]
                  }
                  value={p.body}
                  onChange={(e) => setPath(i, { body: e.target.value })}
                />
                <div className="odyssey-rate" title="這條路讓你多興奮？">
                  <span className="odyssey-rate-label">興奮度</span>
                  {Array.from({ length: 5 }, (_, s) => (
                    <button
                      key={s}
                      className={`sun ${s < p.excitement ? 'on' : ''}`}
                      onClick={() => setPath(i, { excitement: p.excitement === s + 1 ? s : s + 1 })}
                      title={`${s + 1} 分`}
                    >
                      ☀
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
