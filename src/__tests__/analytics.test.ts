import { afterEach, expect, it, vi } from 'vitest'
import { countPageview } from '../analytics'
afterEach(() => vi.unstubAllGlobals())
function context(changed: Partial<Location> = {}) {
  vi.stubGlobal('location', { protocol: 'https:', hostname: 'yikeday.com', pathname: '/', search: '', hash: '', ...changed })
  const seen: { src?: string; referrerPolicy?: string }[] = []
  vi.stubGlobal('Image', class { src = ''; referrerPolicy = ''; constructor() { seen.push(this) } })
  return seen
}
it('official home pixel has no query, URL token, referrer or user-derived title', () => {
  const seen = context(); countPageview(); expect(seen).toHaveLength(1)
  expect(seen[0].referrerPolicy).toBe('no-referrer')
  const url = new URL(seen[0].src!); expect(url.origin).toBe('https://yike.goatcounter.com')
  expect([...url.searchParams.keys()].sort()).toEqual(['p', 'rnd', 't']); expect(url.searchParams.get('p')).toBe('/')
})
it.each([
  { protocol: 'capacitor:' }, { hostname: 'localhost' }, { hostname: 'another.invalid' },
  { pathname: '/recover.html' }, { search: '?code=SYNTHETIC_PRIVATE_CODE' },
  { hash: '#access_token=SYNTHETIC_PRIVATE_TOKEN' },
])('does not count native/dev/other-domain/recovery/private URL %j', changed => {
  const seen = context(changed); countPageview(); expect(seen).toHaveLength(0)
})
it('failure to create a pixel is silent and never changes app state', () => {
  context(); vi.stubGlobal('Image', class { constructor() { throw Error('synthetic failure') } }); expect(() => countPageview()).not.toThrow()
})
