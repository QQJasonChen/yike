import { describe, expect, it } from 'vitest'
import { mdToNotionBlocks, toRichText } from '../../supabase/functions/notion-push/blocks.ts'
import { extractNotionPageId, presetRange } from '../integrations'

describe('mdToNotionBlocks', () => {
  it('轉換 exportMd 產出的各種行', () => {
    const md = [
      '## 📒 一刻手帳 2026-07-01（三）',
      '',
      '**今天最感恩的事**：陽光',
      '### 任務',
      '- [x] ★ 錄影片（專注 3 段／目標 4）',
      '- [ ] 回信',
      '### 時間軸',
      '- 09:00–10:30 深度工作',
      '---',
      '心情 😄 ｜ 生產力 4/5',
    ].join('\n')
    const blocks = mdToNotionBlocks(md)
    const types = blocks.map((b) => b.type)
    expect(types).toEqual([
      'heading_2',
      'paragraph',
      'heading_3',
      'to_do',
      'to_do',
      'heading_3',
      'bulleted_list_item',
      'divider',
      'paragraph',
    ])
    const todos = blocks.filter((b) => b.type === 'to_do') as { to_do: { checked: boolean } }[]
    expect(todos[0].to_do.checked).toBe(true)
    expect(todos[1].to_do.checked).toBe(false)
  })

  it('空行不產生 block', () => {
    expect(mdToNotionBlocks('\n\n  \n')).toEqual([])
  })
})

describe('toRichText', () => {
  it('解析粗體', () => {
    const rich = toRichText('**今日意圖**：專注')
    expect(rich).toHaveLength(2)
    expect(rich[0].annotations?.bold).toBe(true)
    expect(rich[0].text.content).toBe('今日意圖')
    expect(rich[1].text.content).toBe('：專注')
  })

  it('不成對的 ** 視為一般文字', () => {
    const rich = toRichText('a**b')
    expect(rich).toHaveLength(1)
    expect(rich[0].text.content).toBe('a**b')
  })

  it('超過 2000 字自動切段', () => {
    const rich = toRichText('x'.repeat(4500))
    expect(rich.map((r) => r.text.content.length)).toEqual([2000, 2000, 500])
  })
})

describe('extractNotionPageId', () => {
  const dashed = '1fd3a2b4-c5d6-7890-abcd-ef1234567890'
  const raw = dashed.replace(/-/g, '')

  it('從頁面連結抽出 ID（含 query string）', () => {
    expect(extractNotionPageId(`https://www.notion.so/qq/My-Page-${raw}?pvs=4`)).toBe(dashed)
  })

  it('接受已帶連字號的 UUID', () => {
    expect(extractNotionPageId(dashed)).toBe(dashed)
  })

  it('接受裸 32 碼 ID', () => {
    expect(extractNotionPageId(raw)).toBe(dashed)
  })

  it('看不懂時回 null', () => {
    expect(extractNotionPageId('https://www.notion.so/settings')).toBeNull()
    expect(extractNotionPageId('')).toBeNull()
  })
})

describe('presetRange', () => {
  const today = '2026-07-01' // 週三
  it('今天', () => {
    expect(presetRange('today', today)).toEqual({ from: '2026-07-01', to: '2026-07-01' })
  })
  it('近 7 天', () => {
    expect(presetRange('last7', today)).toEqual({ from: '2026-06-25', to: '2026-07-01' })
  })
  it('本週從週一起算', () => {
    expect(presetRange('week', today)).toEqual({ from: '2026-06-29', to: '2026-07-01' })
  })
  it('本月從 1 號起算', () => {
    expect(presetRange('month', today)).toEqual({ from: '2026-07-01', to: '2026-07-01' })
  })
})
