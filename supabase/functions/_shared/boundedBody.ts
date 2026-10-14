// Stream actual bytes rather than trusting Content-Length. No environment or network access.
export class BodyReadError extends Error {
  constructor(readonly status: number) { super('bounded-body-failed') }
}

export const readBoundedJson = async (
  req: Request,
  maxBytes: number,
  timeoutMs: number,
  budget?: AbortSignal,
): Promise<unknown> => {
  const declared = req.headers.get('content-length')
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    void req.body?.cancel().catch(() => {})
    throw new BodyReadError(413)
  }
  if (!req.body) throw new BodyReadError(400)
  const bodyTimeout = new AbortController()
  const timer = setTimeout(() => bodyTimeout.abort(), timeoutMs)
  const signal = AbortSignal.any([req.signal, bodyTimeout.signal, ...(budget ? [budget] : [])])
  const reader = req.body.getReader()
  let finished = false
  let rejectAbort: (error: BodyReadError) => void = () => {}
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject })
  const onAbort = () => rejectAbort(new BodyReadError(408))
  signal.addEventListener('abort', onAbort, { once: true })
  if (signal.aborted) onAbort()
  try {
    const chunks: Uint8Array[] = []
    let bytes = 0
    let reads = 0
    while (true) {
      const chunk = await Promise.race([reader.read(), aborted])
      if (chunk.done) { finished = true; break }
      // A byte cap alone does not bound an endless stream of empty/tiny chunks.
      if (++reads > 4096) throw new BodyReadError(413)
      bytes += chunk.value.byteLength
      if (bytes > maxBytes) throw new BodyReadError(413)
      if (chunk.value.byteLength) chunks.push(chunk.value)
    }
    const decoder = new TextDecoder('utf-8', { fatal: true })
    return JSON.parse(chunks.map(chunk => decoder.decode(chunk, { stream: true })).join('') + decoder.decode())
  } catch (error) {
    if (error instanceof BodyReadError) throw error
    throw new BodyReadError(400)
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
    // Cancellation of an adversarial stream must not hold the response open.
    if (!finished) void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
