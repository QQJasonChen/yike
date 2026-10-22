// 登出／換帳號要把主畫面 widget 清空：快照存在 App Group，跟 localStorage 是兩個地方。
import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock 會被提升到檔案最上面，spy 要用 vi.hoisted 宣告，否則撞 TDZ
const h = vi.hoisted(() => ({ update: vi.fn(async () => {}), native: { on: true } }))
const { update } = h
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => h.native.on },
  registerPlugin: () => ({ update: h.update, drainActions: async () => ({ actions: [] }) }),
}))

import { clearWidgetSnapshot } from '../widgetSync'

beforeEach(() => {
  update.mockClear()
  h.native.on = true
})

describe('clearWidgetSnapshot', () => {
  it('推一份全空的快照給原生（任務、時間軸、整週都空）', async () => {
    await clearWidgetSnapshot()
    expect(update).toHaveBeenCalledTimes(1)
    const snap = JSON.parse((update.mock.calls[0] as unknown as [{ snapshot: string }])[0].snapshot)
    expect(snap.mit).toBe('')
    expect(snap.tasks).toEqual([])
    expect(snap.blocks).toEqual([])
    expect(snap.week).toEqual([])
    expect(snap.streak).toBe(0)
  })

  it('純 web 下是 no-op', async () => {
    h.native.on = false
    await clearWidgetSnapshot()
    expect(update).not.toHaveBeenCalled()
  })

  it('原生端沒 plugin（update 丟例外）→ 不讓登出流程炸掉', async () => {
    update.mockRejectedValueOnce(new Error('plugin not implemented'))
    await expect(clearWidgetSnapshot()).resolves.toBeUndefined()
  })
})
