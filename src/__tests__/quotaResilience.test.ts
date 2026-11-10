// 2026-11-10 用戶事故回歸測試：localStorage 塞滿 → "sb-…-auth-token exceeded the quota" → 無法登入。
// 驗證：(1) 配額滿時仍能保存登入 token；(2) 騰空間只靠「搬」快照，不丟任何資料；
//       (3) 登出／清空裝置時 IndexedDB 裡的 token 與快照一併清除。
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetIdbForTests, STORE_AUTH, STORE_BACKUPS, idbGet, idbKeys, idbSet } from '../idb'
import * as idb from '../idb'
import { __resetAuthMemoryForTests, authStorage } from '../authStorage'
import {
  archiveLocalBackups,
  claimArchivedBackups,
  claimDeviceFor,
  clearAllLocalData,
  clearSupabaseTokens,
  dailyBackupToArchive,
  exportArchivedBackupAsFile,
  listAllBackups,
  listBackups,
  restoreArchivedBackup,
  saveDay,
  setDataOwner,
  autoBackup,
  loadDay,
} from '../storage'

const TOKEN_KEY = 'sb-ofhupqifavtafiylehkj-auth-token'
const UID = '11111111-2222-4333-8444-555555555555'
const LIMIT = 60_000 // 模擬的配額（字元數）

const used = () => {
  let n = 0
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!
    n += k.length + (localStorage.getItem(k)?.length ?? 0)
  }
  return n
}

let realSetItem: typeof Storage.prototype.setItem
const enableQuota = () => {
  realSetItem = Storage.prototype.setItem
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
    const prev = this.getItem(k)
    const next = used() - (prev === null ? 0 : k.length + prev.length) + k.length + String(v).length
    if (next > LIMIT) {
      throw new DOMException(`Failed to execute 'setItem' on 'Storage': Setting the value of '${k}' exceeded the quota.`, 'QuotaExceededError')
    }
    realSetItem.call(this, k, v)
  })
}

const fillWithBackups = (owner: string | null, days: number, size: number) => {
  for (let d = 1; d <= days; d++) {
    const date = `2026-11-${String(d).padStart(2, '0')}`
    const data = { [`pp:day:${date}`]: JSON.stringify({ note: 'x'.repeat(size) }) }
    const id = owner ? `${date}#${owner}` : date
    localStorage.setItem(`pp:bk:${id}`, JSON.stringify({ __yike: 2, owner, data }))
  }
}

beforeEach(() => {
  localStorage.clear()
  globalThis.indexedDB = new IDBFactory()
  __resetIdbForTests()
  __resetAuthMemoryForTests()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('登入 token 在 localStorage 滿時仍能保存', () => {
  it('重現事故：配額滿時 setItem 不再丟錯，token 讀得回來', async () => {
    setDataOwner(UID)
    enableQuota()
    // 用無法搬走的大筆資料塞滿（不是快照），強迫走 IndexedDB 備援
    let i = 0
    try { for (;;) localStorage.setItem(`pp:day:2026-01-${String(++i).padStart(2, '0')}`, 'y'.repeat(5000)) } catch { /* 滿了 */ }
    const before = localStorage.length
    const session = JSON.stringify({ access_token: 'a'.repeat(6000), refresh_token: 'r'.repeat(40) })
    await expect(authStorage.setItem(TOKEN_KEY, session)).resolves.toBeUndefined()
    expect(await authStorage.getItem(TOKEN_KEY)).toBe(session)
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull() // 真的走了 IndexedDB 備援
    // 重開 app（記憶體清空）也拿得到
    __resetAuthMemoryForTests()
    expect(await authStorage.getItem(TOKEN_KEY)).toBe(session)
    // 使用者的日記一筆都沒被動
    expect(localStorage.length).toBe(before)
  })

  it('快照佔滿時，先把快照搬到 IndexedDB，token 回到 localStorage，快照內容完整保留', async () => {
    setDataOwner(UID)
    localStorage.setItem('ppl:bkOwnerMigrated', '1')
    fillWithBackups(UID, 7, 7000)
    enableQuota()
    const originals = listBackups().map((b) => b.id).sort()
    const rawBefore = Object.fromEntries(originals.map((id) => [id, localStorage.getItem(`pp:bk:${id}`)]))
    const session = JSON.stringify({ access_token: 'b'.repeat(20_000) })
    await authStorage.setItem(TOKEN_KEY, session)
    expect(localStorage.getItem(TOKEN_KEY)).toBe(session)
    expect(await idbGet(STORE_AUTH, TOKEN_KEY)).toBeUndefined()
    // 每一份快照都在封存區、內容逐字相同
    const all = await listAllBackups()
    expect(all.map((b) => b.id).sort()).toEqual(originals)
    for (const id of originals) {
      const rec = await idbGet<{ raw: string }>(STORE_BACKUPS, id)
      expect(rec?.raw).toBe(rawBefore[id])
    }
  })

  it('removeItem（登出）會清掉三處：記憶體、localStorage、IndexedDB', async () => {
    await idbSet(STORE_AUTH, TOKEN_KEY, 'old')
    await authStorage.setItem(TOKEN_KEY, 'new')
    expect(await idbGet(STORE_AUTH, TOKEN_KEY)).toBeUndefined() // 回到 localStorage 後舊備援被清
    await authStorage.removeItem(TOKEN_KEY)
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
    expect(await authStorage.getItem(TOKEN_KEY)).toBeNull()
  })

  it('clearSupabaseTokens 也會清掉 IndexedDB 裡的 token 備援', async () => {
    await idbSet(STORE_AUTH, TOKEN_KEY, 'leftover')
    localStorage.setItem(TOKEN_KEY, 'x')
    clearSupabaseTokens()
    await vi.waitFor(async () => expect(await idbKeys(STORE_AUTH)).toEqual([]))
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
  })
})

describe('快照搬遷絕不丟資料', () => {
  it('IndexedDB 寫入失敗時，localStorage 的快照原封不動', async () => {
    setDataOwner(UID)
    localStorage.setItem('ppl:bkOwnerMigrated', '1')
    fillWithBackups(UID, 3, 100)
    const before = listBackups().length
    vi.spyOn(idb, 'idbSet').mockRejectedValue(new Error('quota'))
    expect(await archiveLocalBackups()).toBe(0)
    expect(listBackups().length).toBe(before)
  })

  it('讀回內容不一致時不刪本機那份', async () => {
    setDataOwner(UID)
    localStorage.setItem('ppl:bkOwnerMigrated', '1')
    fillWithBackups(UID, 1, 100)
    const realGet = idb.idbGet
    vi.spyOn(idb, 'idbGet').mockImplementation(async (store, key) => {
      const v = await realGet(store, key)
      return (v && typeof v === 'object' ? { ...(v as object), raw: 'corrupted' } : v) as never
    })
    expect(await archiveLocalBackups()).toBe(0)
    expect(listBackups().length).toBe(1)
  })

  it('還沒蓋 owner 章的 legacy 快照留在本機，等蓋章後再搬', async () => {
    setDataOwner(UID)
    localStorage.setItem('pp:bk:2026-01-01', JSON.stringify({ 'pp:day:2026-01-01': '{}' }))
    await archiveLocalBackups()
    expect(localStorage.getItem('pp:bk:2026-01-01')).not.toBeNull()
  })

  it('封存的快照可匯出、可還原，且只給主人看', async () => {
    setDataOwner(UID)
    localStorage.setItem('ppl:bkOwnerMigrated', '1')
    const data = { 'pp:day:2026-11-01': JSON.stringify({ ...loadDay('2026-11-01'), answers: { m0: '珍貴的一天' } }) }
    localStorage.setItem(`pp:bk:2026-11-01#${UID}`, JSON.stringify({ __yike: 2, owner: UID, data }))
    await archiveLocalBackups()
    expect(listBackups()).toEqual([])
    const file = JSON.parse(await exportArchivedBackupAsFile(`2026-11-01#${UID}`))
    expect(file.data['pp:day:2026-11-01'].answers.m0).toBe('珍貴的一天')
    expect(await restoreArchivedBackup(`2026-11-01#${UID}`)).toBe(1)
    expect(loadDay('2026-11-01').answers.m0).toBe('珍貴的一天')
    // 換成別人：看不到、也匯不出
    setDataOwner('99999999-2222-4333-8444-555555555555')
    expect((await listAllBackups()).filter((b) => b.archived)).toEqual([])
    await expect(exportArchivedBackupAsFile(`2026-11-01#${UID}`)).rejects.toThrow('不屬於')
  })
})

describe('每日快照直接寫進 IndexedDB', () => {
  it('不佔 localStorage，且一天只照一次', async () => {
    saveDay('2026-11-10', { ...loadDay('2026-11-10'), answers: { m0: 'hi' } })
    expect(await dailyBackupToArchive('2026-11-10')).toBe(true)
    expect(listBackups()).toEqual([])
    expect((await listAllBackups()).length).toBe(1)
    expect(await dailyBackupToArchive('2026-11-10')).toBe(true)
    expect((await idbKeys(STORE_BACKUPS)).length).toBe(1)
  })

  it('封存區保留 30 天，超過才輪替', async () => {
    saveDay('2026-11-10', { ...loadDay('2026-11-10'), answers: { m0: 'hi' } })
    for (let d = 1; d <= 35; d++) {
      const key = `2026-${String(Math.ceil(d / 28)).padStart(2, '0')}-${String(((d - 1) % 28) + 1).padStart(2, '0')}`
      localStorage.removeItem('pp:lastBackup')
      await dailyBackupToArchive(key)
    }
    expect((await idbKeys(STORE_BACKUPS)).length).toBe(30)
  })
})

describe('帳號邊界', () => {
  it('純本機快照被搬走後，裝置被認領時一起轉給該帳號', async () => {
    saveDay('2026-11-10', { ...loadDay('2026-11-10'), answers: { m0: 'mine' } })
    expect(autoBackup('2026-11-10', true)).toBe(true)
    await archiveLocalBackups()
    expect((await listAllBackups()).length).toBe(1) // 匿名時看得到
    claimDeviceFor(UID)
    await claimArchivedBackups()
    const mine = await listAllBackups()
    expect(mine.length).toBe(1)
    expect(JSON.parse(await exportArchivedBackupAsFile(mine[0].id)).owner).toBe(UID)
  })

  it('清空這台裝置：封存的快照與 token 備援一併清除', async () => {
    setDataOwner(UID)
    await idbSet(STORE_BACKUPS, `2026-11-01#${UID}`, { raw: '{}', owner: UID, legacy: false, keys: 0, bytes: 2, at: 0 })
    await idbSet(STORE_AUTH, TOKEN_KEY, 't')
    clearAllLocalData()
    await vi.waitFor(async () => {
      expect(await idbKeys(STORE_BACKUPS)).toEqual([])
      expect(await idbKeys(STORE_AUTH)).toEqual([])
    })
  })
})

describe('本機空間用量', () => {
  it('localUsage 反映實際字元數', async () => {
    const { localUsage, LOCAL_SOFT_LIMIT_CHARS } = await import('../storage')
    localStorage.setItem('pp:day:2026-01-01', 'x'.repeat(1_000_000))
    const u = localUsage()
    expect(u.chars).toBeGreaterThanOrEqual(1_000_000)
    expect(u.ratio).toBeCloseTo(u.chars / LOCAL_SOFT_LIMIT_CHARS)
  })
})
