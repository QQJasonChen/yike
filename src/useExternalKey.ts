import { useEffect, useRef, useState } from 'react'

export const EXTERNAL_KEY_EVENT = 'yike:external-key-change'

/** React callback uses current props; both cloud writes and another tab invalidate it. */
export const useExternalKey = (key: string, reload: () => void): void => {
  const latest = useRef(reload)
  latest.current = reload
  useEffect(() => {
    const custom = (event: Event) => {
      if ((event as CustomEvent<{ key: string }>).detail?.key === key) latest.current()
    }
    const storage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) latest.current()
    }
    window.addEventListener(EXTERNAL_KEY_EVENT, custom)
    window.addEventListener('storage', storage)
    return () => {
      window.removeEventListener(EXTERNAL_KEY_EVENT, custom)
      window.removeEventListener('storage', storage)
    }
  }, [key])
}

/** Read-only summaries can depend on a group of journal keys. */
export const useExternalPrefix = (prefix: string): number => {
  const [version, bump] = useState(0)
  useEffect(() => {
    const onKey = (key: string | null) => { if (key === null || key.startsWith(prefix)) bump((n) => n + 1) }
    const custom = (event: Event) => {
      const key = (event as CustomEvent<{ key: string }>).detail?.key
      if (typeof key === 'string') onKey(key)
    }
    const storage = (event: StorageEvent) => onKey(event.key)
    window.addEventListener(EXTERNAL_KEY_EVENT, custom)
    window.addEventListener('storage', storage)
    return () => {
      window.removeEventListener(EXTERNAL_KEY_EVENT, custom)
      window.removeEventListener('storage', storage)
    }
  }, [prefix])
  return version
}
