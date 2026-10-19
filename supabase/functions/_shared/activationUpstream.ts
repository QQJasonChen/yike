import { readBoundedText } from './boundedBody.ts'

// All activation provider/Auth/RPC bodies are buffered within this actual-byte cap.
// The returned Response is bounded even when a caller uses its normal .json().
const MAX_BYTES = 128 * 1024
const CALL_TIMEOUT_MS = 10_000
export async function activationUpstream(url: string, init: RequestInit, budget: AbortSignal): Promise<Response> {
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), CALL_TIMEOUT_MS)
  const signal = AbortSignal.any([budget, timeout.signal])
  let rejectAbort: () => void = () => {}
  const aborted = new Promise<never>((_, reject) => { rejectAbort = () => reject(new Error('activation-upstream-unconfirmed')) })
  void aborted.catch(() => {})
  const onAbort = () => rejectAbort()
  signal.addEventListener('abort', onAbort, { once: true })
  if (signal.aborted) onAbort()
  try {
    if (signal.aborted) throw new Error('activation-upstream-unconfirmed')
    const pending = fetch(url, { ...init, signal, redirect: 'error' })
    // Native fetch honors abort; also bound adapters which do not. A late response
    // may represent a committed Auth/RPC write: cancel its body, never delete/retry.
    void pending.then(res => { if (signal.aborted) void res.body?.cancel().catch(() => {}) }, () => {})
    const res = await Promise.race([pending, aborted])
    if (signal.aborted || (res.status >= 300 && res.status < 400)) {
      void res.body?.cancel().catch(() => {})
      throw new Error('activation-upstream-unconfirmed')
    }
    const text = await readBoundedText({ headers: res.headers, body: res.body, signal } as Request,
      MAX_BYTES, CALL_TIMEOUT_MS, signal)
    if (signal.aborted) throw new Error('activation-upstream-unconfirmed')
    return new Response(text, { status: res.status, headers: res.headers })
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}
