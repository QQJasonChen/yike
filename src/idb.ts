// 極小的 IndexedDB key-value 包裝。
// 為什麼需要它：localStorage 每個網域只有約 5MB，手寫塗鴉＋每日整包快照很快就塞滿，
// 塞滿後連 Supabase 的登入 token 都存不進去（用戶回報：忘記密碼後無法登入，
// "Setting the value of 'sb-…-auth-token' exceeded the quota"）。
// IndexedDB 的配額通常是數百 MB 以上，適合放大型、非同步讀取即可的東西（備份、備援 token）。
const DB_NAME = 'yike'
const DB_VERSION = 1
export const STORE_AUTH = 'auth'
export const STORE_BACKUPS = 'backups'
type StoreName = typeof STORE_AUTH | typeof STORE_BACKUPS

let dbPromise: Promise<IDBDatabase> | null = null

export const idbAvailable = (): boolean => {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null
  } catch {
    return false
  }
}

const open = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (!idbAvailable()) return reject(new Error('indexeddb-unavailable'))
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_AUTH)) db.createObjectStore(STORE_AUTH)
      if (!db.objectStoreNames.contains(STORE_BACKUPS)) db.createObjectStore(STORE_BACKUPS)
    }
    req.onsuccess = () => {
      const db = req.result
      // 其他分頁升級 schema 時讓出連線，下次呼叫重新開
      db.onversionchange = () => { db.close(); dbPromise = null }
      resolve(db)
    }
    req.onerror = () => reject(req.error ?? new Error('indexeddb-open-failed'))
    req.onblocked = () => reject(new Error('indexeddb-blocked'))
  }).catch((e) => {
    dbPromise = null // 失敗不要快取，下次可重試（例如 Safari 私密模式暫時拒絕）
    throw e
  })
  return dbPromise
}

const tx = async <T>(
  store: StoreName,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | undefined> => {
  const db = await open()
  return new Promise<T | undefined>((resolve, reject) => {
    const t = db.transaction(store, mode)
    let result: T | undefined
    const req = run(t.objectStore(store))
    if (req) req.onsuccess = () => { result = req.result }
    // 以 transaction complete 為準：寫入在這之後才算真的落地
    t.oncomplete = () => resolve(result)
    t.onerror = () => reject(t.error ?? new Error('indexeddb-tx-failed'))
    t.onabort = () => reject(t.error ?? new Error('indexeddb-tx-aborted'))
  })
}

export const idbGet = <T>(store: StoreName, key: string): Promise<T | undefined> =>
  tx<T>(store, 'readonly', (s) => s.get(key) as IDBRequest<T>)

export const idbSet = async (store: StoreName, key: string, value: unknown): Promise<void> => {
  await tx(store, 'readwrite', (s) => s.put(value, key))
}

export const idbDelete = async (store: StoreName, key: string): Promise<void> => {
  await tx(store, 'readwrite', (s) => s.delete(key))
}

export const idbKeys = async (store: StoreName): Promise<string[]> =>
  ((await tx<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys())) ?? []).map(String)

export const idbClear = async (store: StoreName): Promise<void> => {
  await tx(store, 'readwrite', (s) => s.clear())
}

/** 測試用：重設連線快取 */
export const __resetIdbForTests = () => {
  dbPromise = null
}
