// session 失效時的資料保護（Codex 互審第 3 輪 P0 + 第 4 輪 P0）。
//
// 策略從「判斷有沒有未同步、有就不清」改成「一律不清」。原因：
// 判斷本身會猜錯——sync gate 關閉期間的編輯只進記憶體不寫 dirty，
// 還沒跑過 migrateDirtyOnce 的舊資料也不在 dirty 裡。猜錯的代價是永久毀資料，
// 而 session 過期本來就只是要重新登入，沒有理由順手刪日記。
import { beforeEach, describe, expect, it } from 'vitest'
import {
  autoBackup, clearAllLocalData, clearCloudSessionArtifacts, hasCloudArtifact,
  listBackups, loadDay, markCloudBound, saveDay, setOpenAIKey, toDateKey,
} from '../storage'
import { DayEntry, emptyDay, emptyTask } from '../types'

const day = (t: string): DayEntry => ({ ...emptyDay(), tasks: [{ ...emptyTask(), text: t }] })
const TODAY = toDateKey(new Date())

beforeEach(() => localStorage.clear())

describe('session 失效時一律不毀資料', () => {
  it('未同步的日記留著', () => {
    saveDay(TODAY, day('離線時寫的，還沒上傳'))
    markCloudBound()
    clearCloudSessionArtifacts()
    expect(loadDay(TODAY).tasks[0].text).toBe('離線時寫的，還沒上傳')
  })

  it('已同步過的日記也留著（不能拿「雲端有一份」當刪除的理由）', () => {
    saveDay(TODAY, day('已經同步過的'))
    localStorage.removeItem('ppl:dirty')
    markCloudBound()
    clearCloudSessionArtifacts()
    expect(loadDay(TODAY).tasks[0].text).toBe('已經同步過的')
  })

  it('每日備份留著', () => {
    saveDay(TODAY, day('要保住的'))
    autoBackup(TODAY)
    markCloudBound()
    clearCloudSessionArtifacts()
    expect(listBackups().length).toBeGreaterThan(0)
    expect(localStorage.getItem('pp:bk:' + TODAY)!).toContain('要保住的')
  })

  it('雲端綁定標記要清掉，否則會一直重跑這條路徑', () => {
    markCloudBound()
    expect(hasCloudArtifact()).toBe(true)
    clearCloudSessionArtifacts()
    expect(hasCloudArtifact()).toBe(false)
  })

  it('使用者主動「清空這台裝置」仍然全部清光，含備份與金鑰', () => {
    saveDay(TODAY, day('要清光的'))
    autoBackup(TODAY)
    setOpenAIKey('sk-proj-WIPE-ME', 'gpt-4o-mini')
    clearAllLocalData()
    expect(listBackups().length).toBe(0)
    expect(JSON.stringify(localStorage)).not.toContain('sk-proj-WIPE-ME')
  })
})
