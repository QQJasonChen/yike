import { useEffect, useState } from 'react'
import { NameField, TextArea, TextField } from './fields'
import Gantt, { spanToCells } from './Gantt'
import { loadLife, saveLife } from './storage'
import { LifeEntry } from './types'

// 願景：一頁看見長遠的方向（北極星 + 十年甘特 + 奧德賽三條路）
const HORIZON = 10 // 甘特顯示幾年

// 奧德賽儀表（《生命設計師》原版四儀表：資源/興奮/自信/一致）
function Rate({
  label,
  hint,
  glyph,
  value,
  onValue,
}: {
  label: string
  hint: string
  glyph: string
  value: number
  onValue: (v: number) => void
}) {
  return (
    <div className="odyssey-rate" title={hint}>
      <span className="odyssey-rate-label">{label}</span>
      {Array.from({ length: 5 }, (_, s) => (
        <button
          key={s}
          className={`sun ${s < value ? 'on' : ''}`}
          onClick={() => onValue(value === s + 1 ? s : s + 1)}
          title={`${s + 1} 分`}
        >
          {glyph}
        </button>
      ))}
    </div>
  )
}

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
          <TextArea
            className="northstar-input"
            rows={2}
            placeholder="我想成為什麼樣的人？想去哪裡？（寫一句就好，當作所有選擇的北極星）"
            value={entry.northStar}
            onValue={(v) => update({ northStar: v })}
          />
        </div>

        {/* 願景大目標 */}
        <div className="label">想完成的大事</div>
        {entry.goals.map((g, i) => (
          <div key={i} className={`week-task-row ${g.done ? 'done' : ''}`}>
            <span className="task-num">{i + 1}.</span>
            <NameField
              value={g.text}
              placeholder={i === 0 ? '如果這十年只完成一件，你會選哪一件？' : ''}
              onValue={(v) => setGoal(i, { text: v })}
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
          hint="點一年＝選/取消（可挑不連續）・拖曳＝一次選連續多年・雙擊橫條清那段"
          emptyHint="先寫下想完成的大事，這裡就會出現可拖拉的十年時程"
          cols={Array.from({ length: HORIZON }, (_, i) => ({
            label: `'${String((start + i) % 100).padStart(2, '0')}`,
            sub: i === 4 ? '五年' : i === 9 ? '十年' : undefined,
            today: start + i === thisYear,
            active: i === 4 || i === 9,
          }))}
          rows={entry.goals
            .map((g, i) => ({ ...g, i, cells: g.cells ?? spanToCells(g.span) }))
            .filter((g) => g.text.trim())}
          onCells={(i, cells) => setGoal(i, { cells, span: null })}
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
                <TextField
                  className="odyssey-title"
                  value={p.title}
                  placeholder={['現在這條路', '如果它消失了', '不管錢與面子'][i]}
                  onValue={(v) => setPath(i, { title: v })}
                />
                <TextArea
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
                  onValue={(v) => setPath(i, { body: v })}
                />
                <div className="odyssey-dash">
                  <Rate
                    label="資源"
                    hint="時間、錢、技能，夠走這條路嗎？"
                    glyph="◆"
                    value={p.resources ?? 0}
                    onValue={(v) => setPath(i, { resources: v })}
                  />
                  <Rate
                    label="興奮"
                    hint="這條路讓你多興奮？"
                    glyph="☀"
                    value={p.excitement}
                    onValue={(v) => setPath(i, { excitement: v })}
                  />
                  <Rate
                    label="自信"
                    hint="我做得成嗎？"
                    glyph="▲"
                    value={p.confidence ?? 0}
                    onValue={(v) => setPath(i, { confidence: v })}
                  />
                  <Rate
                    label="一致"
                    hint="跟你的北極星同一個方向嗎？"
                    glyph="✦"
                    value={p.coherence ?? 0}
                    onValue={(v) => setPath(i, { coherence: v })}
                  />
                </div>
                <TextArea
                  className="odyssey-questions"
                  rows={2}
                  placeholder="這條路引出什麼問題？（例：收入從哪來？家人怎麼想？）"
                  value={p.questions ?? ''}
                  onValue={(v) => setPath(i, { questions: v })}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
