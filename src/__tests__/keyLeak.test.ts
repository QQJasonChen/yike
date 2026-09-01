import { beforeEach, describe, expect, it } from 'vitest'
import {
  allDataKeys, autoBackup, exportAll, exportBackupAsFile,
  getOpenAIKey, saveDay, setDataOwner, setOpenAIKey,
} from '../storage'

const SECRET = 'sk-proj-THISMUSTNEVERLEAK1234567890'

beforeEach(() => {
  localStorage.clear()
  saveDay('2026-09-01', {
    mit: '日記內容', answers: {}, habitsDone: {}, tasks: [],
    focusSessions: [], score: null, mood: null,
  } as never)
  setOpenAIKey(SECRET, 'gpt-5.4-mini')
  setDataOwner('some-uid')
})

describe('OpenAI 金鑰不得從任何出口離開這台裝置', () => {
  it('不在同步清單裡（allDataKeys 決定什麼會被推上雲）', () => {
    expect(getOpenAIKey()).toBe(SECRET) // 確認確實存進去了
    expect(allDataKeys().join('|')).not.toContain('openai')
    for (const k of allDataKeys()) expect(localStorage.getItem(k)).not.toContain(SECRET)
  })

  it('不在完整匯出檔裡', () => {
    expect(exportAll()).not.toContain(SECRET)
  })

  it('不在每日快照裡（快照會被「存成檔案」帶出裝置）', () => {
    autoBackup('2026-09-01')
    expect(exportBackupAsFile('2026-09-01')).not.toContain(SECRET)
  })

  it('裝置歸屬與髒標記也不會被同步出去', () => {
    const keys = allDataKeys().join('|')
    expect(keys).not.toContain('owner')
    expect(keys).not.toContain('dirty')
  })

  it('清除金鑰會連型號一起清掉，不留殘跡', () => {
    setOpenAIKey('')
    expect(getOpenAIKey()).toBe('')
    expect(JSON.stringify(localStorage)).not.toContain(SECRET)
  })
})
