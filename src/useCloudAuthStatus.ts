import { useEffect, useState } from 'react'
import { cloudEnabled, supa } from './cloud'

/** Auth status only: a session is not proof that the latest edits have synced. */
export const useCloudAuthStatus = (): boolean | null => {
  const [signedIn, setSignedIn] = useState<boolean | null>(null)

  useEffect(() => {
    if (!cloudEnabled()) return
    let disposed = false
    let sawAuthChange = false
    let unsubscribe: (() => void) | undefined

    void supa().then((db) => {
      if (disposed) return
      const { data } = db.auth.onAuthStateChange((event, session) => {
        if (disposed) return
        // A delayed initialization must not replace a newer sign-in/sign-out.
        if (event === 'INITIAL_SESSION') {
          if (sawAuthChange) return
        } else {
          sawAuthChange = true
        }
        // Keep this callback synchronous. Calling Auth APIs here can hold its lock.
        setSignedIn(Boolean(session?.user))
      })
      unsubscribe = () => data.subscription.unsubscribe()
      if (disposed) unsubscribe()
    }).catch(() => {
      if (!disposed && !sawAuthChange) setSignedIn(false)
    })

    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [])

  return signedIn
}
