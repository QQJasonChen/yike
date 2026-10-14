// Markdown → Notion blocks 轉換器（純函數，無 Deno API——vitest 與 edge function 共用）
// 只需支援 exportMd.ts 產出的子集：#/##/### 標題、- [ ] 待辦、- 清單、---、**粗體**、段落

export type NotionBlock = Record<string, unknown>

interface RichText {
  type: 'text'
  text: { content: string }
  annotations?: { bold: boolean }
}

export class NotionConversionLimitError extends Error {
  constructor() { super('notion-conversion-limit') }
}

interface ConversionLimits { maxBlocks?: number; maxRichTextParts?: number }

const MAX_TEXT = 2000 // Notion 單段 rich_text 上限

/** 把一行文字的 **粗體** 解析成 rich_text 陣列（超長自動切段） */
export const toRichText = (line: string, maxParts = Infinity): RichText[] => {
  const out: RichText[] = []
  const push = (content: string, bold: boolean) => {
    for (let i = 0; i < content.length; i += MAX_TEXT) {
      if (out.length >= maxParts) throw new NotionConversionLimitError()
      const chunk = content.slice(i, i + MAX_TEXT)
      out.push(bold ? { type: 'text', text: { content: chunk }, annotations: { bold: true } } : { type: 'text', text: { content: chunk } })
    }
  }
  // 以 ** 切割：奇數段為粗體（不成對的 ** 視為一般文字）
  const parts = line.split('**')
  if (parts.length % 2 === 0) {
    push(line, false)
    return out
  }
  parts.forEach((p, i) => {
    if (p) push(p, i % 2 === 1)
  })
  return out.length ? out : [{ type: 'text', text: { content: '' } }]
}

const block = (type: string, rich: RichText[]): NotionBlock => ({
  object: 'block',
  type,
  [type]: { rich_text: rich },
})

/** exportMd 風格的 Markdown → Notion block 陣列 */
export const mdToNotionBlocks = (md: string, limits: ConversionLimits = {}): NotionBlock[] => {
  const blocks: NotionBlock[] = []
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) continue
    // Stop object creation at the cap instead of materializing thousands of
    // blocks/rich-text objects before the handler checks their final count.
    if (blocks.length >= (limits.maxBlocks ?? Infinity)) throw new NotionConversionLimitError()
    if (line.trim() === '---') {
      blocks.push({ object: 'block', type: 'divider', divider: {} })
      continue
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/)
    if (h) {
      blocks.push(block(`heading_${h[1].length}`, toRichText(h[2], limits.maxRichTextParts)))
      continue
    }
    const todo = line.match(/^- \[([ xX])\]\s?(.*)$/)
    if (todo) {
      blocks.push({
        object: 'block',
        type: 'to_do',
        to_do: { rich_text: toRichText(todo[2], limits.maxRichTextParts), checked: todo[1] !== ' ' },
      })
      continue
    }
    const li = line.match(/^-\s+(.*)$/)
    if (li) {
      blocks.push(block('bulleted_list_item', toRichText(li[1], limits.maxRichTextParts)))
      continue
    }
    blocks.push(block('paragraph', toRichText(line, limits.maxRichTextParts)))
  }
  return blocks
}
