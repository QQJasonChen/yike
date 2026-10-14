/** Supabase query builder 的最小假物件。
 *  cloud.ts 的查詢會接 .abortSignal(signal)（逾時要能真的中止請求），
 *  所以 mock 必須同時是 thenable 又有 abortSignal。
 *  **必須惰性**：寫成 Object.assign(exec(), { abortSignal: () => exec() }) 會讓
 *  exec 立刻跑一次、abortSignal 再跑一次，任何「數執行次數」的斷言都會多算一倍。 */
export interface LazyQuery<T> {
  abortSignal: (s: AbortSignal) => Promise<T>
  then: <R>(res: (v: T) => R, rej?: (e: unknown) => R) => Promise<R>
  order: (col: string, opts?: unknown) => LazyQuery<T>
  range: (from: number, to: number) => LazyQuery<T>
}

/** pull 現在會分頁（.order().range()），所以 builder 也要吃得下這兩個；
 *  它們回自己，惰性不變——測試資料一頁裝得下，迴圈跑一輪就結束。 */
export const lazyQuery = <T>(exec: (signal?: AbortSignal) => Promise<T>): LazyQuery<T> => {
  const q: LazyQuery<T> = {
    abortSignal: (s: AbortSignal) => exec(s),
    then: <R>(res: (v: T) => R, rej?: (e: unknown) => R) => exec().then(res, rej),
    order: () => q,
    range: () => q,
  }
  return q
}

export const query = <T>(get: () => T) => lazyQuery(async () => get())

/** cloud.ts 的 push 現在走兩條路：雲端已有的 key 用 `upsert`（帶 CAS），
 *  「我相信雲端還沒有」的 key 用 `insert`（讓唯一鍵自己擋併發新增）。
 *  在 mock 眼裡兩者行為相同——都是「送出去、回傳伺服器存了什麼」——
 *  所以把 upsert 直接當成 insert 用，省得每個測試檔各寫一份。
 *  不補的話測試會炸在 `db.from(...).insert is not a function`。 */
export const withInsert = <T extends { upsert: unknown }>(o: T): T & { insert: T['upsert'] } => ({
  ...o,
  insert: o.upsert,
})

/** 寫入類查詢的回傳形狀。錯誤分支的測試要用它——不然基準 mock 會把 `error` 的
 *  型別推成 `null`，`tsc -b`（npm run build 用的那道閘，會檢查測試檔）就過不了。
 *  註：`npx tsc --noEmit` 跟 `tsc -b` 不是同一道閘，要以 build 為準。 */
export interface DbError {
  code?: string
  message: string
}
export interface WriteResult {
  data: { key: string; updated_at: string; client_rev?: number | string | null }[]
  error: DbError | null
}
