import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extractNotionPageId, loadNotionConfig, notionPageUrl, NotionPushError, pushToNotion, saveNotionConfig } from '../integrations'

const ID = '1fd3a2b4-c5d6-7890-abcd-ef1234567890'
const RAW = ID.replace(/-/g, '')
const PAGE = `https://www.notion.so/${RAW}`
const cfg = { token: 'synthetic-notion-secret', parentPageId: ID, parentUrl: PAGE }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
let fetcher: ReturnType<typeof vi.fn>
beforeEach(() => {
  localStorage.clear()
  fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => vi.unstubAllGlobals())

describe('Notion page links stay on official HTTPS destinations', () => {
  it.each([
    ID, RAW, `https://www.notion.so/My-Page-${RAW}?pvs=4#comment`,
    `https://notion.so/workspace/${ID}`, `https://workspace.notion.site/Title-${RAW}`,
  ])('normalizes a valid page reference: %s', input => {
    expect(extractNotionPageId(input)).toBe(ID)
    expect(notionPageUrl(input)).toBe(PAGE)
  })
  it.each([
    `javascript:alert('${RAW}')`, `http://www.notion.so/${RAW}`,
    `https://evil.example/${RAW}`, `https://notion.so.evil.example/${RAW}`,
    `https://evilnotion.so/${RAW}`, `https://www.notion.so@evil.example/${RAW}`,
    `https://user:password@www.notion.so/${RAW}`, `https://www.notion.so:444/${RAW}`,
    `https://www.notion.so/settings?next=${RAW}`, `https://www.notion.so/settings#${RAW}`,
    `prefix-${ID}-suffix`, `https://www.notion.so/${RAW}/children`,
    `https://www.notion.so/${RAW}\n/path`, `https://www.notion.so/x\t/${RAW}`,
  ])('rejects a scheme/host/path that cannot identify an official page: %s', input => {
    expect(extractNotionPageId(input)).toBeNull()
    expect(notionPageUrl(input)).toBeNull()
  })
  it('normalizes saved legacy display URLs without trusting their href', () => {
    localStorage.setItem('pp:integrations', JSON.stringify({ ...cfg, parentUrl: `javascript:alert('${RAW}')` }))
    expect(loadNotionConfig()).toEqual(cfg)
    saveNotionConfig({ ...cfg, parentUrl: `https://evil.example/${RAW}` })
    expect(JSON.parse(localStorage.getItem('pp:integrations')!).parentUrl).toBe(PAGE)
  })
  it('rejects malformed saved config and does not overwrite it with an invalid destination', () => {
    saveNotionConfig(cfg)
    expect(() => saveNotionConfig({ ...cfg, parentPageId: `https://evil.example/${RAW}` })).toThrow()
    expect(loadNotionConfig()).toEqual(cfg)
    localStorage.setItem('pp:integrations', JSON.stringify({ token: {}, parentPageId: ID }))
    expect(loadNotionConfig()).toBeNull()
  })
})

describe('single Notion write with inspectable outcomes', () => {
  it('requires strict success plus a safe page receipt, without following redirects', async () => {
    fetcher.mockResolvedValue(response({ ok: true, url: `${PAGE}?pvs=4` }))
    await expect(pushToNotion(cfg, 'Synthetic title', 'Synthetic content')).resolves.toEqual({ url: PAGE })
    expect(fetcher).toHaveBeenCalledOnce()
    const init = fetcher.mock.calls[0][1] as RequestInit
    expect(init.redirect).toBe('error')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(init.body as string).parentPageId).toBe(ID)
  })
  it.each([400, 504])('retains the created page when later content fails (%i)', async status => {
    fetcher.mockResolvedValue(response({ error: 'Synthetic append failure', url: PAGE }, status))
    await expect(pushToNotion(cfg, 'Synthetic', 'Synthetic')).rejects.toMatchObject({
      name: 'NotionPushError', outcome: 'partial', url: PAGE,
    })
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('network failure is uncertain and is never automatically retried', async () => {
    fetcher.mockRejectedValue(new Error('Synthetic connection loss'))
    await expect(pushToNotion(cfg, 'Synthetic', 'Synthetic')).rejects.toMatchObject({ outcome: 'uncertain' })
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it.each([
    { ok: true }, { ok: 'true', url: PAGE }, { ok: true, url: `javascript:alert('${RAW}')` },
    { ok: true, url: `https://evil.example/${RAW}` }, { ok: true, error: 'conflicting status', url: PAGE },
    { ok: true, outcome: 'partial', url: PAGE },
  ])('cannot claim complete for an ambiguous/untrusted receipt: %j', async body => {
    fetcher.mockResolvedValue(response(body))
    const failure = await pushToNotion(cfg, 'Synthetic', 'Synthetic').catch(e => e)
    expect(failure).toBeInstanceOf(NotionPushError)
    expect(failure.outcome).toBe(notionPageUrl(body.url ?? '') ? 'partial' : 'uncertain')
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('body parse failure after a write is uncertain; a successful HTTP status is not enough', async () => {
    fetcher.mockResolvedValue(new Response('<html>not a receipt</html>'))
    await expect(pushToNotion(cfg, 'Synthetic', 'Synthetic')).rejects.toMatchObject({ outcome: 'uncertain' })
  })
  it('bounds response consumption and retains uncertain status for truncation', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ error: 'x'.repeat(70 * 1024) })))
    await expect(pushToNotion(cfg, 'Synthetic', 'Synthetic')).rejects.toMatchObject({ outcome: 'uncertain' })
  })
  it('a read-only connection test needs no newly created page and cannot imply a write', async () => {
    fetcher.mockResolvedValueOnce(response({ ok: true })).mockRejectedValueOnce(new Error('Synthetic loss'))
    await expect(pushToNotion(cfg, '', '', true)).resolves.toEqual({})
    await expect(pushToNotion(cfg, '', '', true)).rejects.toMatchObject({ outcome: 'rejected', url: undefined })
    expect(fetcher.mock.calls.every(([, init]) => JSON.parse(init.body as string).dryRun === true)).toBe(true)
  })
  it('fails before a request when configuration is invalid', async () => {
    await expect(pushToNotion({ ...cfg, parentPageId: 'not-a-page' }, 'Synthetic', 'Synthetic'))
      .rejects.toMatchObject({ outcome: 'rejected' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
