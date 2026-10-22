// deno test supabase/functions/agent-api/logic_test.ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { PAGE, bearerOf, isDateKey, isReadableKey, paginate, parseRoute, sha256Hex } from './logic.ts'

const u = (s: string) => new URL(`https://x.supabase.co/functions/v1/agent-api${s}`)

Deno.test('白名單：只有手帳內容拿得到', () => {
  for (const k of ['pp:day:2026-10-22', 'pp:week:2026-10-19', 'pp:month:2026-10', 'pp:quarter:2026-Q4', 'pp:year:2026', 'pp:life', 'pp:bizmodel', 'pp:settings'])
    assertEquals(isReadableKey(k), true, k)
  // 裝置／同步機制用的、本機專用的，一律拿不到——這是整支 API 最重要的一條
  for (const k of ['pp:sync', 'pp:integrations', 'pp:bk:2026-10-22', 'pp:meta', 'pp:lastBackup', 'pp:cloudBound', 'ppl:openaiKey', 'ppl:conflict:1:pp:day:2026-10-22', 'ppl:timer', 'pp:day:', 'pp:', '', 'journal'])
    assertEquals(isReadableKey(k), false, k)
})

Deno.test('日期要是真的日期', () => {
  assertEquals(isDateKey('2026-10-22'), true)
  assertEquals(isDateKey('2026-02-30'), false)
  assertEquals(isDateKey('2026-1-2'), false)
  assertEquals(isDateKey("2026-10-22' or 1=1"), false)
})

Deno.test('路由', () => {
  assertEquals(parseRoute(u('/schema')), { kind: 'schema' })
  assertEquals(parseRoute(u('/me')), { kind: 'me' })
  assertEquals(parseRoute(u('/keys')), { kind: 'keys' })
  assertEquals(parseRoute(u('/day/2026-10-22')), { kind: 'day', date: '2026-10-22' })
  assertEquals(parseRoute(u('/day/not-a-date')).kind, 'bad')
  assertEquals(parseRoute(u('/days?from=2026-10-01&to=2026-10-22')), { kind: 'days', from: '2026-10-01', to: '2026-10-22' })
  assertEquals(parseRoute(u('/days?from=2026-10-22&to=2026-10-01')).kind, 'bad') // from > to
  assertEquals(parseRoute(u('/days?from=2026-01-01&to=2026-12-31')).kind, 'bad') // > 92 天
  assertEquals(parseRoute(u('/days?from=2026-01-01&to=2026-04-02')), { kind: 'days', from: '2026-01-01', to: '2026-04-02' }) // 剛好 92
  assertEquals(parseRoute(u('/days?from=2026-01-01&to=2026-04-03')).kind, 'bad') // 93
  assertEquals(parseRoute(u('/entry/pp:settings')), { kind: 'entry', key: 'pp:settings' })
  assertEquals(parseRoute(u('/entry/pp%3Aweek%3A2026-10-19')), { kind: 'entry', key: 'pp:week:2026-10-19' })
  assertEquals(parseRoute(u('/entry/pp:sync')).kind, 'bad')
  assertEquals(parseRoute(u('/entry/ppl:openaiKey')).kind, 'bad')
  assertEquals(parseRoute(u('/nope')).kind, 'bad')
  // 解不開的 percent-encoding：要是受控的 400，不是 URIError 炸出去
  const bad = parseRoute(u('/entry/%FF'))
  assertEquals(bad.kind, 'bad')
  if (bad.kind === 'bad') assertEquals(bad.status, 400)
  assertEquals(parseRoute(u('')).kind, 'bad')
})

Deno.test('Bearer 解析', () => {
  assertEquals(bearerOf('Bearer yk_abcdefghijklmnopqrstuvwxyz0123'), 'yk_abcdefghijklmnopqrstuvwxyz0123')
  assertEquals(bearerOf('bearer yk_abcdefghijklmnopqrstuvwxyz0123'), null) // 大小寫要對
  assertEquals(bearerOf('Bearer eyJhbGciOi.xxx.yyy'), null) // 拿 Supabase JWT 來打也不行
  assertEquals(bearerOf('Bearer yk_short'), null)
  assertEquals(bearerOf(null), null)
})

Deno.test('分頁：拉到不滿一頁為止，失敗就丟、不回不完整清單', async () => {
  const total = PAGE * 2 + 3
  const all = Array.from({ length: total }, (_, i) => i)
  const calls: number[] = []
  const got = await paginate(async (off, lim) => {
    calls.push(off)
    return all.slice(off, off + lim)
  })
  assertEquals(got.length, total)
  assertEquals(calls, [0, PAGE, PAGE * 2])
  // 剛好整數頁：還要多拉一頁（空的）才能確定沒有下一頁
  const exact = Array.from({ length: PAGE }, (_, i) => i)
  assertEquals((await paginate(async (off, lim) => exact.slice(off, off + lim))).length, PAGE)
  // 某一頁失敗 → 丟錯，不能把前面幾頁當完整結果
  let threw = false
  try {
    await paginate(async (off) => (off === PAGE ? null : exact.slice(0, PAGE)))
  } catch {
    threw = true
  }
  assertEquals(threw, true)
})

Deno.test('hash 穩定且不可逆地不同', async () => {
  const a = await sha256Hex('yk_one')
  assertEquals(a, await sha256Hex('yk_one'))
  assertEquals(a.length, 64)
  assertEquals(a === (await sha256Hex('yk_two')), false)
})
