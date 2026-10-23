// BYOK 的兩個「畫面永遠轉圈」路徑，以及「宣告可以用、第一次分析才失敗」的型號挑選。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateInsight, verifyKeyAndPickModel } from '../ai'
import { setOpenAIKey } from '../storage'

const realFetch = globalThis.fetch

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
})
afterEach(() => {
  vi.useRealTimers()
  globalThis.fetch = realFetch
})

/** headers 回來了，但 body 永遠讀不完（連線半死／代理吃掉／伺服器不收尾）。
 *  必須尊重 AbortSignal，否則就是真的永遠等下去。 */
const stallingBody = (signal?: AbortSignal) =>
  Promise.resolve({
    status: 200,
    ok: true,
    json: () =>
      new Promise((_res, rej) => {
        signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
      }),
  } as unknown as Response)

describe('verifyKeyAndPickModel：逾時要涵蓋讀 body', () => {
  it('body 卡住 → 15 秒後回逾時，不會永遠停在「驗證中…」', async () => {
    globalThis.fetch = vi.fn((_u, init) =>
      stallingBody((init as RequestInit | undefined)?.signal ?? undefined)
    ) as unknown as typeof fetch
    const p = verifyKeyAndPickModel('sk-test')
    await vi.advanceTimersByTimeAsync(15_000)
    await expect(p).resolves.toEqual({ ok: false, error: '連線逾時，請確認網路後再試一次' })
  })
})

describe('generateInsight：本體那一次呼叫也要有逾時', () => {
  beforeEach(() => setOpenAIKey('sk-test'))

  it('完全沒回應 → 60 秒後丟逾時錯誤，不會永遠停在「分析中…」', async () => {
    globalThis.fetch = vi.fn(
      (_u, init) =>
        new Promise((_res, rej) => {
          ;(init as RequestInit).signal?.addEventListener('abort', () =>
            rej(new DOMException('aborted', 'AbortError'))
          )
        })
    ) as unknown as typeof fetch
    const p = generateInsight('prompt', 'data')
    const assertion = expect(p).rejects.toThrow('AI 逾時')
    await vi.advanceTimersByTimeAsync(60_000)
    await assertion
  })

  it('headers 回來但 body 卡住 → 也要逾時（clearTimeout 太早就會漏掉這條）', async () => {
    globalThis.fetch = vi.fn((_u, init) =>
      stallingBody((init as RequestInit | undefined)?.signal ?? undefined)
    ) as unknown as typeof fetch
    const p = generateInsight('prompt', 'data')
    const assertion = expect(p).rejects.toThrow('AI 逾時')
    await vi.advanceTimersByTimeAsync(60_000)
    await assertion
  })
})

describe('型號挑選：只能挑聊天模型', () => {
  const withModels = (ids: string[]) => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        status: 200,
        ok: true,
        json: () => Promise.resolve({ data: ids.map((id) => ({ id })) }),
      } as unknown as Response)
    ) as unknown as typeof fetch
  }

  it('不能挑到 tts / realtime / audio / image / embedding', async () => {
    withModels([
      'gpt-4o-mini-tts',
      'gpt-4o-realtime-preview',
      'gpt-4o-audio-preview',
      'gpt-image-1',
      'gpt-4o-transcribe',
      'gpt-4o-search-preview',
      'gpt-4.1-nano',
    ])
    await expect(verifyKeyAndPickModel('sk-test')).resolves.toEqual({
      ok: true,
      model: 'gpt-4.1-nano',
    })
  })

  it('只有非聊天模型 → 明說不能用，不要先宣告成功', async () => {
    withModels(['gpt-4o-mini-tts', 'gpt-image-1', 'text-embedding-3-small'])
    const r = await verifyKeyAndPickModel('sk-test')
    expect(r.ok).toBe(false)
  })

  it('偏好清單優先（帳號有 gpt-4o-mini 就用它，不要拿一個奇怪的 gpt-）', async () => {
    withModels(['gpt-3.5-turbo-instruct', 'gpt-4o-mini'])
    await expect(verifyKeyAndPickModel('sk-test')).resolves.toEqual({
      ok: true,
      model: 'gpt-4o-mini',
    })
  })
})
