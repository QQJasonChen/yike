import { useEffect, useState } from 'react'
import { TextField } from './fields'
import { loadBizModel, saveBizModel } from './storage'
import { BizBlockKey, BizItem, BizModel } from './types'

// 九宮格區塊：DOM 順序＝手機直排的閱讀順序。
// title＝企業版原名（跟一般商模圖對得上）；hint＝《Business Model You》個人版「以人為主」的問法。
const BLOCKS: { key: BizBlockKey; title: string; hint: string }[] = [
  { key: 'value', title: '價值主張', hint: '你如何幫助？他們「雇用」你來完成什麼工作' },
  { key: 'segments', title: '目標客群', hint: '你幫助誰？把最關鍵的人圈出來' },
  { key: 'channels', title: '通路', hint: '別人怎麼認識你、你怎麼把價值交付給他們' },
  { key: 'relationships', title: '客戶關係', hint: '你怎麼跟他們互動、維繫關係' },
  { key: 'activities', title: '關鍵活動', hint: '你做什麼？（從「你是誰」自然長出來的事）' },
  { key: 'resources', title: '關鍵資源', hint: '你是誰＋你擁有什麼：興趣、技能、個性、經驗、人脈' },
  { key: 'partners', title: '關鍵合作夥伴', hint: '誰幫助你：夥伴、貴人、工具、平台' },
  { key: 'costs', title: '成本結構', hint: '你付出什麼：時間、精力、金錢，還有壓力' },
  { key: 'revenue', title: '收益', hint: '你得到什麼：收入，還有成長、成就感、滿足' },
]

// 「怎麼運作」示意圖：九格 mini 版，短標＋三區底色（zone）。
// zone: how＝你靠什麼做到（左）／out＝你對外的價值（右＋中）／econ＝划不划算（底）
const DIAG: { key: BizBlockKey; label: string; zone: 'how' | 'out' | 'econ' }[] = [
  { key: 'partners', label: '誰幫你', zone: 'how' },
  { key: 'activities', label: '你做什麼', zone: 'how' },
  { key: 'resources', label: '你是誰＋擁有什麼', zone: 'how' },
  { key: 'value', label: '你如何幫助', zone: 'out' },
  { key: 'relationships', label: '怎麼互動', zone: 'out' },
  { key: 'channels', label: '怎麼認識·交付', zone: 'out' },
  { key: 'segments', label: '你幫助誰', zone: 'out' },
  { key: 'costs', label: '付出什麼', zone: 'econ' },
  { key: 'revenue', label: '得到什麼', zone: 'econ' },
]

const newTagId = () => `t${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`

export default function BizModelView() {
  const [model, setModel] = useState<BizModel>(loadBizModel)
  const [filter, setFilter] = useState<Set<string>>(new Set()) // 只看哪些標籤層（空＝全部）
  const [editTags, setEditTags] = useState(false)
  const [picker, setPicker] = useState<{ block: BizBlockKey; i: number } | null>(null)
  const [showHelp, setShowHelp] = useState(false) // 「怎麼運作」詳細說明是否展開

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
        <p className="section-sub">商模 — 把「你這個人」畫成一張商業模式圖，正職＋副業放一起。</p>

        <p className="biz-intro">
          用顏色標出<b>現在 vs 未來</b>、<b>正職 vs 副業</b>——點圖例某個顏色，就能<b>只看那一層</b>，看哪些跟客群、價值對不上，那就是可以砍的。
        </p>

        <button className="biz-help-toggle" onClick={() => setShowHelp((v) => !v)}>
          <span className={`biz-help-caret ${showHelp ? 'open' : ''}`}>▸</span>
          這張商模怎麼運作？
        </button>
        {showHelp && (
          <div className="biz-help">
            <p className="biz-help-lead">
              把「你這個人」畫成一張商業模式圖（<i>Business Model You</i>）——正職＋副業放一起，因為餵飽你的是<b>同一個人</b>。
            </p>

            {/* 讀圖方向：右 → 左 */}
            <div className="biz-diagram-flow">
              <span className="zone-tag how">② 你靠什麼做到</span>
              <span className="biz-flow-arrow">←</span>
              <span className="zone-tag out">① 你幫誰、給什麼價值</span>
            </div>

            {/* 九格 mini 示意圖 */}
            <div className="biz-diagram">
              {DIAG.map((d) => (
                <div key={d.key} className={`biz-diag-box biz-b-${d.key} zone-${d.zone}`}>
                  {d.label}
                </div>
              ))}
            </div>
            <div className="biz-diagram-econ">
              <span className="zone-tag econ">③ 划不划算</span>
              付出（時間·壓力） vs 得到（錢·成長·滿足）
            </div>

            <p className="biz-help-note">
              <b>用顏色疊圖：</b>標出「正職／副業」「現在／未來」，點圖例只看那一層。
              每條都要能連回<b>目標客群</b>和<b>價值主張</b>，連不上的那條就是可以砍的。
            </p>

            <div className="biz-steps">
              <span>
                <em>畫現在</em>的你
              </span>
              <span className="biz-step-arrow">→</span>
              <span>
                <em>反思</em>哪裡卡
              </span>
              <span className="biz-step-arrow">→</span>
              <span>
                想做的標<em>未來</em>色
              </span>
              <span className="biz-step-arrow">→</span>
              <span>
                挑一個<em>小實驗</em>去測
              </span>
            </div>
          </div>
        )}

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
