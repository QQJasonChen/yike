// session 失效時的資料保護。這是整場互審裡最嚴重的一條（Codex 第 3 輪 P0）：
// 離線寫日記 → token 過期 → 開 app → 資料連同七天備份一起消失且無法復原。
import { beforeEach, describe, expect, it } from 'vitest'
import {
  autoBackup, clearAllLocalData, clearCloudDataOnSessionLoss,
  listBackups, loadDay, saveDay, setOpenAIKey, toDateKey,
} from '../storage'
import { DayEntry, emptyDay, emptyTask } from '../types'

const day = (t: string): DayEntry => ({ ...emptyDay(), tasks: [{ ...emptyTask(), text: t }] })
const TODAY = toDateKey(new Date())

beforeEach(() => localStorage.clear())

describe('session 失效時不得毀掉還沒上雲的東西', () => {
  it('有未同步內容時直接拒絕清除', () => {
    saveDay(TODAY, day('離線時寫的，還沒上傳'))
    expect(clearCloudDataOnSessionLoss()).toBe(false)
    expect(loadDay(TODAY).tasks[0].text).toBe('離線時寫的，還沒上傳')
  })

  it('沒有未同步內容時可以清，但備份必須留著', () => {
    saveDay(TODAY, day('已經同步過的'))
    autoBackup(TODAY)
    localStorage.removeItem('ppl:dirty') // 模擬全部已同步
    expect(clearCloudDataOnSessionLoss()).toBe(true)
    expect(loadDay(TODAY).tasks[0].text).toBe('') // 資料清掉了
    expect(listBackups().length).toBeGreaterThan(0) // 備份還在
    const raw = localStorage.getItem('pp:bk:' + TODAY)!
    expect(raw).toContain('已經同步過的') // 而且救得回來
  })

  it('清除時金鑰也要帶走（跟「清空裝置」一致）', () => {
    setOpenAIKey('sk-proj-SESSION-LOSS', 'gpt-4o-mini')
    localStorage.removeItem('ppl:dirty')
    clearCloudDataOnSessionLoss()
    expect(JSON.stringify(localStorage)).not.toContain('sk-proj-SESSION-LOSS')
  })

  it('使用者主動「清空這台裝置」仍然是全部清掉，含備份', () => {
    saveDay(TODAY, day('要清光的'))
    autoBackup(TODAY)
    clearAllLocalData()
    expect(listBackups().length).toBe(0)
  })
})
