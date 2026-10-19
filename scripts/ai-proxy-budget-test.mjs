// Real candidate SQL, synthetic accounts/configuration, no network/provider calls.
// PGlite serializes a single connection; this does NOT prove hosted concurrency.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const pg = new PGlite()
const A = '00000000-0000-4000-8000-000000000001'
const B = '00000000-0000-4000-8000-000000000002'
const CONTRACT = 'yike-ai-proxy-v1'
const UNITS = 33792 * 2 + 700 * 4 // synthetic price bounds, NOT provider prices
let passed = 0
const check = async (name, fn) => { await fn(); passed++; console.log(`PASS ${name}`) }
const sqlFile = path => readFile(new URL(path, import.meta.url), 'utf8')
const asRole = async (role, fn) => {
  await pg.exec(`set role ${role}`)
  try { return await fn() } finally { await pg.exec('reset role') }
}
const denied = fn => assert.rejects(fn, error => error.code === '42501')
const reserve = (uid = A, contract = CONTRACT) => asRole('service_role', async () =>
  (await pg.query('select public.ai_proxy_reserve($1,$2) as receipt', [uid, contract])).rows[0].receipt)
const state = async () => (await pg.query(`select jsonb_build_object(
  'global',(select jsonb_agg(t) from public.ai_proxy_global_usage t),
  'daily',(select jsonb_agg(t order by day) from public.ai_proxy_daily_usage t),
  'user',(select jsonb_agg(t order by user_id,day) from public.ai_proxy_user_usage t)) as state`)).rows[0].state
const configure = async () => {
  await pg.exec(`update public.ai_proxy_config set enabled=true,contract='${CONTRACT}',model='gpt-4o-mini-2024-07-18',
    input_nano_usd_per_token=2,output_nano_usd_per_token=4,daily_request_cap=10,daily_budget_units=${UNITS * 10},
    lifetime_request_cap=100,lifetime_budget_units=${UNITS * 100},user_daily_request_cap=3,
    valid_until=statement_timestamp()+interval '1 day';
    update public.ai_proxy_global_usage set requests=0,reserved_units=0;
    truncate public.ai_proxy_daily_usage, public.ai_proxy_user_usage;`)
}
const rejectsWithoutChange = async (reason = 'config', uid = A, contract = CONTRACT) => {
  const before = await state()
  assert.deepEqual(await reserve(uid, contract), { contract: CONTRACT, allowed: false, reason })
  assert.deepEqual(await state(), before)
}
try {
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    grant usage on schema public to anon,authenticated,service_role;`)
  await pg.query('insert into auth.users values($1),($2)', [A, B])
  await pg.exec(await sqlFile('../supabase/migrations/20260623000000_ai_usage.sql'))
  await pg.exec(await sqlFile('../supabase/migrations/20261018010000_ai_proxy_budget.sql'))
  await check('fresh migration is disabled; no quota/price/expiry is inferred', async () => {
    const cfg = (await pg.query('select * from public.ai_proxy_config')).rows[0]
    assert.equal(cfg.enabled, false)
    assert.equal(cfg.daily_budget_units, null)
    await rejectsWithoutChange()
  })
  await check('enabled=true alone cannot activate an incomplete configuration', async () => {
    await pg.exec('update public.ai_proxy_config set enabled=true')
    await rejectsWithoutChange()
  })
  const required = ['contract','model','input_nano_usd_per_token','output_nano_usd_per_token',
    'daily_request_cap','daily_budget_units','lifetime_request_cap','lifetime_budget_units','user_daily_request_cap','valid_until']
  for (const column of required) await check(`missing ${column} fails closed with no reservation`, async () => {
    await configure(); await pg.exec(`update public.ai_proxy_config set ${column}=null`); await rejectsWithoutChange()
  })
  const invalid = [
    "enabled=false", "contract='other'", "model='gpt-4o-mini'", "input_nano_usd_per_token=0",
    "output_nano_usd_per_token=-1", "input_nano_usd_per_token=1000000001", "output_nano_usd_per_token=1000000001",
    'daily_request_cap=0', 'daily_request_cap=100001', 'daily_budget_units=-1', 'daily_budget_units=1000000000000001',
    'lifetime_request_cap=0', 'lifetime_request_cap=1000000001', 'lifetime_budget_units=0', 'lifetime_budget_units=1000000000000000001',
    'user_daily_request_cap=0', 'user_daily_request_cap=16', "valid_until=statement_timestamp()-interval '1 second'",
    "valid_until=statement_timestamp()+interval '32 days'", "valid_until='infinity'", 'lifetime_request_cap=1', 'lifetime_budget_units=1',
  ]
  for (const assignment of invalid) await check(`invalid config ${assignment} fails closed`, async () => {
    await configure(); await pg.exec(`update public.ai_proxy_config set ${assignment}`); await rejectsWithoutChange()
  })
  await check('missing config singleton fails closed', async () => {
    await configure(); const cfg = (await pg.query('select * from public.ai_proxy_config')).rows[0]
    await pg.exec('delete from public.ai_proxy_config'); await rejectsWithoutChange()
    await pg.query('insert into public.ai_proxy_config select * from jsonb_populate_record(null::public.ai_proxy_config,$1)', [JSON.stringify(cfg)])
  })
  await check('missing global ledger fails closed rather than creating a fresh budget', async () => {
    await configure(); await pg.exec('delete from public.ai_proxy_global_usage'); await rejectsWithoutChange()
    await pg.exec('insert into public.ai_proxy_global_usage(singleton) values(true)')
  })
  await check('unknown/null user and unknown contract fail closed', async () => {
    await configure()
    await rejectsWithoutChange('config', '00000000-0000-4000-8000-000000000099')
    await rejectsWithoutChange('config', null); await rejectsWithoutChange('config', A, 'other')
  })
  await check('configuration lease expired during the current statement fails closed without a reservation', async () => {
    await configure(); const before = await state()
    const receipt = (await pg.query(`with changed as materialized (
      update public.ai_proxy_config set valid_until=statement_timestamp()+interval '50 milliseconds' returning singleton
    ), delayed as materialized (select pg_sleep(0.075) from changed)
    select public.ai_proxy_reserve($1,$2) as receipt from delayed`, [A, CONTRACT])).rows[0].receipt
    assert.deepEqual(receipt, { contract: CONTRACT, allowed: false, reason: 'config' })
    assert.deepEqual(await state(), before)
  })
  await check('valid reservation atomically pre-debits global lifetime, UTC day and exact user', async () => {
    await configure(); assert.deepEqual(await reserve(), { contract: CONTRACT, allowed: true, reserved_units: UNITS })
    const s = await state()
    assert.equal(s.global[0].requests, 1); assert.equal(s.global[0].reserved_units, UNITS)
    assert.equal(s.daily[0].requests, 1); assert.equal(s.daily[0].reserved_units, UNITS)
    assert.equal(s.user[0].user_id, A); assert.equal(s.user[0].requests, 1)
  })
  await check('per-user cap denies A while B can reserve only from the same global budget', async () => {
    await configure(); await reserve(); await reserve(); await reserve(); await rejectsWithoutChange('quota')
    assert.equal((await reserve(B)).allowed, true); assert.equal((await state()).global[0].requests, 4)
  })
  await check('daily global request cap applies across users without incrementing denied attempts', async () => {
    await configure(); await pg.exec('update public.ai_proxy_config set daily_request_cap=1')
    await reserve(); await rejectsWithoutChange('quota', B)
  })
  await check('daily integer budget reserves whole worst-case cost and rejects the remainder', async () => {
    await configure(); await pg.exec(`update public.ai_proxy_config set daily_budget_units=${UNITS * 2 - 1}`)
    await reserve(); await rejectsWithoutChange('quota', B)
  })
  await check('budget too small for a single request rejects before any mutation', async () => {
    await configure(); await pg.exec(`update public.ai_proxy_config set daily_budget_units=${UNITS - 1}`)
    await rejectsWithoutChange('quota')
  })
  await check('lifetime request cap survives UTC daily reset', async () => {
    await configure(); await pg.exec('update public.ai_proxy_config set daily_request_cap=1,lifetime_request_cap=1')
    await reserve(); await pg.exec('truncate public.ai_proxy_daily_usage,public.ai_proxy_user_usage')
    await rejectsWithoutChange('quota', B)
  })
  await check('lifetime integer budget survives daily reset', async () => {
    await configure(); await pg.exec(`update public.ai_proxy_config set daily_budget_units=${UNITS},lifetime_budget_units=${UNITS * 2 - 1}`)
    await reserve(); await pg.exec('truncate public.ai_proxy_daily_usage,public.ai_proxy_user_usage')
    await rejectsWithoutChange('quota', B)
  })
  await check('statement failure after global update rolls back every quota ledger', async () => {
    await configure()
    await pg.exec(`create function public.synthetic_ai_failure() returns trigger language plpgsql as $$ begin raise exception 'synthetic failure'; end $$;
      create trigger synthetic_ai_failure before insert on public.ai_proxy_user_usage for each row execute function public.synthetic_ai_failure();`)
    const before = await state(); await assert.rejects(() => reserve(), /synthetic failure/); assert.deepEqual(await state(), before)
    await pg.exec('drop trigger synthetic_ai_failure on public.ai_proxy_user_usage; drop function public.synthetic_ai_failure()')
    assert.equal((await reserve()).allowed, true)
  })
  await check('provider failure/unknown outcome retains pre-debit; no release/refund RPC exists', async () => {
    await configure(); await reserve(); const before = await state()
    assert.deepEqual(await state(), before)
    assert.deepEqual((await pg.query("select proname from pg_proc where pronamespace='public'::regnamespace and proname like 'ai_proxy_%'")).rows, [{ proname: 'ai_proxy_reserve' }])
    assert.equal(before.global[0].reserved_units, UNITS)
  })
  for (const role of ['anon', 'authenticated', 'service_role']) await check(`${role} cannot read/reset counters, change prices/budgets or invoke legacy bypass`, async () => {
    await configure(); const before = await state()
    await asRole(role, async () => {
      for (const table of ['ai_proxy_config','ai_proxy_global_usage','ai_proxy_daily_usage','ai_proxy_user_usage']) {
        await denied(() => pg.query(`select * from public.${table}`))
        await denied(() => pg.query(`delete from public.${table}`))
        await denied(() => pg.query(`update public.${table} set ${table === 'ai_proxy_config' ? 'enabled=false' : 'requests=0'}`))
        await denied(() => pg.query(`insert into public.${table} select * from public.${table}`))
        await denied(() => pg.query(`truncate public.${table}`))
      }
      await denied(() => pg.query('update public.ai_proxy_config set daily_budget_units=1000000000'))
      await denied(() => pg.query('update public.ai_proxy_global_usage set reserved_units=0'))
      await denied(() => pg.query('select public.ai_usage_bump($1,1000000000)', [A]))
      if (role !== 'service_role') await denied(() => pg.query('select public.ai_proxy_reserve($1,$2)', [A, CONTRACT]))
    })
    assert.deepEqual(await state(), before)
  })
  await check('50 distinct accounts cannot multiply the shared daily request cap', async () => {
    await configure()
    await pg.exec(`update public.ai_proxy_config set daily_request_cap=7,daily_budget_units=${UNITS * 50},user_daily_request_cap=1`)
    const ids = (await pg.query("insert into auth.users select ('00000000-0000-4000-9000-' || lpad(n::text,12,'0'))::uuid from generate_series(1,50) n returning id")).rows
    let accepted = 0, rejected = 0
    for (const { id } of ids) {
      const receipt = await reserve(id)
      if (receipt.allowed) accepted++
      else { assert.equal(receipt.reason, 'quota'); rejected++ }
    }
    assert.equal(accepted, 7); assert.equal(rejected, 43)
    const result = await state()
    assert.equal(result.global[0].requests, 7); assert.equal(result.global[0].reserved_units, UNITS * 7)
    assert.equal(result.daily[0].requests, 7); assert.equal(result.user.length, 7)
    assert.equal(result.user.every(row => row.requests === 1), true)
  })
  await check('daily ledger uses UTC even when the database session has a different timezone', async () => {
    await configure(); await pg.exec("set timezone='Pacific/Kiritimati'")
    try {
      assert.equal((await reserve()).allowed, true)
      const expected = (await pg.query("select (statement_timestamp() at time zone 'UTC')::date::text as today")).rows[0].today
      assert.equal((await state()).daily[0].day, expected)
      assert.equal((await state()).user[0].day, expected)
    } finally { await pg.exec("set timezone='UTC'") }
  })
  await check('owner legacy RPC also returns false and preserves legacy usage records', async () => {
    await pg.query('insert into public.ai_usage values($1,current_date,7)', [A])
    assert.equal((await pg.query('select public.ai_usage_bump($1,9999999) as allowed', [A])).rows[0].allowed, false)
    assert.equal((await pg.query('select count from public.ai_usage where user_id=$1', [A])).rows[0].count, 7)
  })
  await check('reviewed rollback disables new reservations without changing any existing ledger or legacy denial', async () => {
    await configure(); await reserve(); await reserve(); await reserve(B)
    const before = await state()
    const cfg = (await pg.query('select * from public.ai_proxy_config')).rows[0]
    const legacy = (await pg.query('select * from public.ai_usage order by user_id,day')).rows
    await pg.exec(await sqlFile('../supabase/rollback/20261018010000_ai_proxy_disable.sql'))
    assert.deepEqual((await pg.query('select * from public.ai_proxy_config')).rows[0], { ...cfg, enabled: false })
    await rejectsWithoutChange('config', B)
    assert.deepEqual(await state(), before)
    assert.deepEqual((await pg.query('select * from public.ai_usage order by user_id,day')).rows, legacy)
    assert.equal((await pg.query('select public.ai_usage_bump($1,9999999) as allowed', [A])).rows[0].allowed, false)
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await asRole(role, () => denied(() => pg.query('select public.ai_usage_bump($1,9999999)', [A])))
    }
  })
  await check('reviewed rollback is repeatable and preserves all pre-debits', async () => {
    await configure(); await reserve(); const before = await state()
    const disable = await sqlFile('../supabase/rollback/20261018010000_ai_proxy_disable.sql')
    await pg.exec(disable)
    const disabled = (await pg.query('select * from public.ai_proxy_config')).rows[0]
    await pg.exec(disable)
    assert.deepEqual((await pg.query('select * from public.ai_proxy_config')).rows[0], disabled)
    assert.deepEqual(await state(), before)
    await rejectsWithoutChange('config', B)
  })
  await check('authenticated account deletion preserves global pre-debits', async () => {
    await configure(); await reserve(); const before = (await state()).global
    await pg.query('delete from auth.users where id=$1', [A])
    assert.deepEqual((await state()).global, before); await rejectsWithoutChange('config', A)
  })
  console.log(JSON.stringify({ passed, production: false, scope: 'SYNTHETIC_PGLITE_SINGLE_CONNECTION', multiSessionConcurrency: 'not tested', providerPricingOrBillCap: 'not verified; synthetic upper-bound estimate only' }))
} finally { await pg.close() }
