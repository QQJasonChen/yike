/** Stop stale React state before it can write under another tab's new owner. */
export const watchOwnerChange = (onChanged: () => void): (() => void) => {
  const on = (event: StorageEvent) => {
    if (event.key !== null && event.key !== 'ppl:owner') return
    if (event.key === 'ppl:owner' && event.oldValue === event.newValue) return
    onChanged()
  }
  window.addEventListener('storage', on)
  return () => window.removeEventListener('storage', on)
}
