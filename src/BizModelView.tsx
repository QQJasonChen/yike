import { useEffect, useState } from 'react'
import { TextField } from './fields'
import { loadBizModel, saveBizModel } from './storage'
import { BizBlockKey, BizItem, BizModel } from './types'

// 九宮格區塊：DOM 順序＝手機直排的閱讀順序；area 決定桌機九宮格位置（見 styles.css .biz-grid）
const BLOCKS: { key: BizBlockKey; area: string; title: string; hint: string }[] = [
  { key: 'value', area: 'value', title: '價值主張', hint: '你提供什麼獨到價值？非你不可的是什麼' },
  { key: 'segments', area: 'segments', title: '目標客群', hint: '你幫助誰？把最關鍵的人圈出來' },
  { key: 'channels', area: 'channels', title: '通路', hint: '怎麼把價值送到他們面前' },
  { key: 'relationships', area: 'relationships', title: '客戶關係', hint: '怎麼跟他們互動、維繫' },
  { key: 'activities', area: 'activities', title: '關鍵活動', hint: '你固定要做的核心動作' },
  { key: 'resources', area: 'resources', title: '關鍵資源', hint: '你的技能、經驗、身分、內容' },
  { key: 'partners', area: 'partners', title: '關鍵合作夥伴', hint: '幫得上你的工具、人、平台' },
  { key: 'costs', area: 'costs', title: '成本結構', hint: '你付出的時間、金錢、心力' },
  { key: 'revenue', area: 'revenue', title: '收益', hint: '你得到的——錢、成長、成就感' },
]

const newTagId = () => `t${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`

export default function BizModelView() {
  const [model, setModel] = useState<BizModel>(loadBizModel)
  const [filter, setFilter] = useState<Set<string>>(new Set()) // 只看哪些標籤層（空＝全部）
  const [editTags, setEditTags] = useState(false)
  const [picker, setPicker] = useState<{ block: BizBlockKey; i: number } | null>(null)

  // 換頁回來時重新讀（雲端同步可能拉到新資料）
  useEffect(() => {
    setModel(loadBizModel())
  }, [])

  const update = (patch: Partial<BizModel>) => {
    setModel((prev) => {
      const next = { ...prev, ...patch }
      saveBizModel(next)
      return next
    })
  }

  const setItems = (block: BizBlockKey, items: BizItem[]) => update({ [block]: items } as Partial<BizModel>)

  const setItem = (block: BizBlockKey, i: number, patch: Partial<BizItem>) => {
    const items = model[block].slice()
    items[i] = { ...items[i], ...patch }
    setItems(block, items)
  }
  const addItem = (block: BizBlockKey) => setItems(block, [...model[block], { text: '' }])
  const removeItem = (block: BizBlockKey, i: number) =>
    setItems(block, model[block].filter((_, j) => j !== i))

  const setTag = (id: string, patch: Partial<BizModel['tags'][number]>) =>
    update({ tags: model.tags.map((t) => (t.id === id ? { ...t, ...patch } : t)) })
  const addTag = () =>
    update({ tags: [...model.tags, { id: newTagId(), label: '新標籤', color: '#9a8f7d' }] })
  const removeTag = (id: string) => {
    // 刪標籤時，把用到它的項目標籤一併清掉（不讓孤兒 tag id 殘留）
    const tags = model.tags.filter((t) => t.id !== id)
    const cleared: Partial<BizModel> = { tags }
    for (const b of BLOCKS) {
      const items = model[b.key]
      if (items.some((it) => it.tag === id))
        cleared[b.key] = items.map((it) => (it.tag === id ? { ...it, tag: undefined } : it))
    }
    update(cleared)
    setFilter((prev) => {
      const n = new Set(prev)
      n.delete(id)
      return n
    })
  }

  const toggleFilter = (id: string) =>
    setFilter((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const tagOf = (id?: string) => model.tags.find((t) => t.id === id)
  const filtering = filter.size > 0
  const dimmed = (it: BizItem) => filtering && !(it.tag && filter.has(it.tag))

  return (
    <div className="page">
      <div className="page-inner" onClick={() => picker && setPicker(null)}>
        <h2 className="section-title">Business Model You</h2>
        <p className="section-sub">獲利模式 — 把「你這個人」當成一個模式，正職＋副業畫在同一張圖上。</p>

        <p className="biz-intro">
          填九宮格：右邊<b>你幫助誰</b>、中間<b>給他們什麼價值</b>、左邊<b>你靠什麼做到</b>、底下<b>付出與收穫</b>。
          用顏色標出「正職／副業」「現在／未來」——點圖例的顏色，就能<b>只看某一層</b>，看哪些項目跟客群、價值對不上，那就是可以砍的。
        </p>

        {/* 圖例／顏色標籤盤：平常是「只看這層」的篩選器，按「編輯」可改名、改色、增減 */}
        <div className="biz-legend">
          {model.tags.map((t) =>
            editTags ? (
              <span key={t.id} className="biz-legend-chip editing">
                <label className="biz-tag-swatch" style={{ background: t.color }}>
                  <input
                    type="color"
                    value={t.color}
                    onChange={(e) => setTag(t.id, { color: e.currentTarget.value })}
                  />
                </label>
                <TextField
                  className="biz-tag-name"
                  value={t.label}
                  onValue={(v) => setTag(t.id, { label: v })}
                  aria-label="標籤名稱"
                />
                <button className="biz-tag-del" title="刪除這個標籤" onClick={() => removeTag(t.id)}>
                  ×
                </button>
              </span>
            ) : (
              <button
                key={t.id}
                className={`biz-legend-chip ${filter.has(t.id) ? 'active' : ''} ${
                  filtering && !filter.has(t.id) ? 'off' : ''
                }`}
                onClick={() => toggleFilter(t.id)}
                title="點擊只看這一層（可多選）"
              >
                <span className="biz-dot" style={{ background: t.color }} />
                {t.label}
              </button>
            )
          )}
          {editTags ? (
            <>
              <button className="biz-legend-tool" onClick={addTag}>
                ＋ 新增標籤
              </button>
              <button className="biz-legend-tool done" onClick={() => setEditTags(false)}>
                完成
              </button>
            </>
          ) : (
            <>
              {filtering && (
                <button className="biz-legend-tool" onClick={() => setFilter(new Set())}>
                  顯示全部
                </button>
              )}
              <button className="biz-legend-tool" onClick={() => setEditTags(true)}>
                ✎ 編輯標籤
              </button>
            </>
          )}
        </div>

        {/* 九宮格 */}
        <div className="biz-grid">
          {BLOCKS.map((b) => (
            <section key={b.key} className={`biz-block biz-b-${b.key}`}>
              <div className="biz-block-title">{b.title}</div>
              <div className="biz-block-hint">{b.hint}</div>
              <div className="biz-items">
                {model[b.key].map((it, i) => {
                  const tag = tagOf(it.tag)
                  const open = picker && picker.block === b.key && picker.i === i
                  return (
                    <div key={i} className={`biz-item ${dimmed(it) ? 'dim' : ''}`}>
                      <button
                        className="biz-item-dot"
                        style={tag ? { background: tag.color, borderColor: tag.color } : undefined}
                        title={tag ? tag.label : '貼上顏色標籤'}
                        onClick={(e) => {
                          e.stopPropagation()
                          setPicker(open ? null : { block: b.key, i })
                        }}
                      />
                      <TextField
                        className="biz-item-input"
                        value={it.text}
                        placeholder="寫一項⋯"
                        onValue={(v) => setItem(b.key, i, { text: v })}
                      />
                      <button
                        className="biz-item-del"
                        title="刪除這一項"
                        onClick={() => removeItem(b.key, i)}
                      >
                        ×
                      </button>
                      {open && (
                        <div
                          className={`biz-picker ${b.key === 'costs' || b.key === 'revenue' ? 'up' : ''}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {model.tags.map((t) => (
                            <button
                              key={t.id}
                              className="biz-picker-opt"
                              onClick={() => {
                                setItem(b.key, i, { tag: t.id })
                                setPicker(null)
                              }}
                            >
                              <span className="biz-dot" style={{ background: t.color }} />
                              {t.label}
                            </button>
                          ))}
                          <button
                            className="biz-picker-opt none"
                            onClick={() => {
                              setItem(b.key, i, { tag: undefined })
                              setPicker(null)
                            }}
                          >
                            <span className="biz-dot empty" /> 無標籤
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
                <button className="biz-add" onClick={() => addItem(b.key)}>
                  ＋ 新增一項
                </button>
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
