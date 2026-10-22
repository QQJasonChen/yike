import { useCallback, useEffect, useRef, useState } from 'react'
import { getDataOwner } from './storage'
import { EXTERNAL_KEY_EVENT, useExternalKey } from './useExternalKey'

const failedDrafts = new Map<string, unknown>()
const draftId = (key: string, owner: string | null) => JSON.stringify([owner, key])
export const hasUnsavedDrafts = (): boolean => {
  const owner = getDataOwner()
  return [...failedDrafts.keys()].some((key) => (JSON.parse(key) as unknown[])[0] === owner)
}
/** Only an explicit device wipe clears the in-memory drafts which could not be stored. */
export const clearUnsavedDrafts = () => failedDrafts.clear()

/** Full-object controls (settings/tasks) report only fields changed by this user gesture. */
export const changedFields = <T extends object>(before: T, after: T): Partial<T> => {
  const patch: Partial<T> = {}
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)]) as Set<keyof T>)
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) patch[key] = after[key]
  return patch
}

/** Timeline controls return an array: preserve remote additions and untouched block fields. */
export const rebaseItems = <T extends { id: string }>(current: T[], before: T[], after: T[]): T[] => {
  const previous = new Map(before.map((item) => [item.id, item]))
  const proposed = new Map(after.map((item) => [item.id, item]))
  const result = current.filter((item) => !previous.has(item.id) || proposed.has(item.id))
    .map((item) => {
      const old = previous.get(item.id), next = proposed.get(item.id)
      return old && next ? { ...item, ...changedFields(old, next) } : item
    })
  for (const item of after) if (!previous.has(item.id) && !result.some((saved) => saved.id === item.id)) result.push(item)
  return result
}

/** 跟 hook 裡的 edit 同一套規則，但不綁 React state——給「畫面上那個元件可能沒 mount」的寫入用
 *  （番茄鐘完成時使用者可能在週/月分頁）。
 *  - 以同一個 failedDrafts 為基準：有存不進去的草稿就疊在草稿上，不會把它蓋掉；
 *    存失敗時結果進草稿，下次成功存檔會一起帶上，不是鈴響了一格都沒記。
 *  - owner 守衛同 canWrite：expectedOwner 是按下開始時的主人，現在不一樣就擋。 */
export const editStoredKey = <T,>(
  key: string,
  load: () => T,
  save: (value: T) => boolean,
  change: (current: T) => T,
  expectedOwner: string | null
): boolean => {
  if (getDataOwner() !== expectedOwner) {
    window.dispatchEvent(new Event('yike:owner-change-blocked'))
    return false
  }
  const id = draftId(key, expectedOwner)
  const pending = failedDrafts.get(id) as T | undefined
  const base = pending !== undefined ? pending : load()
  const next = change(base)
  // 沒改而且也沒有待存的草稿：不存、不發事件。有草稿的話照存——這次就是它的重試機會
  if (Object.is(next, base) && pending === undefined) return true
  const ok = save(next)
  if (ok) failedDrafts.delete(id)
  else failedDrafts.set(id, next)
  if (ok) window.dispatchEvent(new CustomEvent(EXTERNAL_KEY_EVENT, { detail: { key } }))
  return ok
}

/** Only this edit is applied to current storage; a failed local save keeps its draft. */
export const useStoredEntry = <T,>(key: string, load: () => T, save: (value: T) => boolean) => {
  const [entry, setEntry] = useState<T>(() => (failedDrafts.get(draftId(key, getDataOwner())) as T | undefined) ?? load())
  const latest = useRef({ key, load, save })
  latest.current = { key, load, save }
  const draft = useRef({ key, value: entry, failed: failedDrafts.has(draftId(key, getDataOwner())) })
  const owner = useRef(getDataOwner())
  const reload = useCallback(() => {
    if (getDataOwner() !== owner.current) {
      window.dispatchEvent(new Event('yike:owner-change-blocked'))
      return
    }
    const current = latest.current
    const pending = failedDrafts.get(draftId(current.key, owner.current)) as T | undefined
    if (pending !== undefined) {
      draft.current = { key: current.key, value: pending, failed: true }
      setEntry(pending)
      return
    }
    // 草稿 map 是唯一真相：別處（editStoredKey，例如番茄鐘完成）已經把草稿連同結果存進去，
    // 這裡的 failed 旗標就不能再卡住 reload，否則下一次編輯會用舊草稿整頁回存
    if (draft.current.key === current.key && draft.current.failed) draft.current.failed = false
    // An external update must not silently discard text which never reached storage.
    if (draft.current.key === current.key && draft.current.failed) return
    const value = current.load()
    draft.current = { key: current.key, value, failed: false }
    setEntry(value)
  }, [])
  useEffect(() => { reload() }, [key, reload])
  useExternalKey(key, reload)
  useEffect(() => {
    // Only the local login UI emits this after authentication + explicit owner decision.
    // Another tab's storage event must never silently adopt its owner.
    const ready = (event: Event) => {
      const nextOwner = (event as CustomEvent<{ owner: string | null }>).detail?.owner
      if (nextOwner === undefined || nextOwner !== getDataOwner() || failedDrafts.has(draftId(latest.current.key, owner.current))) return
      owner.current = nextOwner
      draft.current.failed = false
      reload()
    }
    window.addEventListener('yike:local-owner-ready', ready)
    return () => window.removeEventListener('yike:local-owner-ready', ready)
  }, [reload])
  const canWrite = useCallback(() => {
    if (getDataOwner() === owner.current) return true
    window.dispatchEvent(new Event('yike:owner-change-blocked'))
    return false
  }, [])
  const edit = useCallback((change: (current: T) => T): boolean => {
    if (!canWrite()) return false
    const current = latest.current
    // A native editor or delayed callback may finish after the user navigated to a different key.
    if (current.key !== key) return false
    const base = draft.current.key === current.key && draft.current.failed
      ? draft.current.value : current.load()
    const next = change(base)
    const ok = current.save(next)
    const id = draftId(current.key, owner.current)
    if (ok) failedDrafts.delete(id)
    else failedDrafts.set(id, next)
    draft.current = { key: current.key, value: next, failed: !ok }
    setEntry(next)
    if (ok) window.dispatchEvent(new CustomEvent(EXTERNAL_KEY_EVENT, { detail: { key: current.key } }))
    return ok
  }, [canWrite, key])
  return { entry, edit, reload, canWrite }
}
