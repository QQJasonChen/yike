// Actual PostgreSQL SQL, synthetic isolated database only. No network/credentials.
// Native PG17 can reuse setupNamespaceFixture/runNamespaceChecks with query+exec adapter.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
const NAME = 'journal_key_namespace_known_data_v1'
const A = '00000000-0000-4000-8000-000000000001'
export const acceptedNamespaceKeys = [
  'pp:day:0001-01-01', 'pp:day:0096-02-29', 'pp:day:0099-12-31', 'pp:day:2000-02-29',
  'pp:week:2026-10-14', 'pp:day:9999-12-31', 'pp:month:0001-01', 'pp:month:9999-12',
  'pp:quarter:0001-Q1', 'pp:quarter:9999-Q4', 'pp:year:0001', 'pp:year:9999',
  'pp:settings', 'pp:life', 'pp:bizmodel', 'pp:pipAuto', 'pp:onboarded',
]
export const rejectedNamespaceKeys = [
  'ppl:owner', 'sb-project-auth-token', 'pp:meta', 'pp:sync', 'pp:integrations',
  'pp:bk:2026-10-14', 'pp:lastBackup', 'pp:cloudBound', 'pp:habitsAutoRestored', 'pp:unknown',
  'pp:pipauto', 'pp:day:0000-01-01', 'pp:day:1900-02-29', 'pp:day:2100-02-29',
  'pp:day:2026-02-30', 'pp:day:2026-04-31', 'pp:day:2026-13-01', 'pp:day:2026-01-00',
  'pp:week:2026-11-31', 'pp:month:2026-00', 'pp:month:2026-13', 'pp:year:0000',
  'pp:quarter:0000-Q1', 'pp:quarter:2026-Q5', 'pp:day:2026-1-01', 'pp:day:2026-10-14\n',
  'pp:settings:suffix',
]
export async function setupNamespaceFixture(pg) {
  await pg.exec(`create schema auth; create role anon; create role authenticated; create role service_role bypassrls;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`)
  await pg.exec(await readFile(new URL('./fixtures/journal-resource-limits-schema.sql', import.meta.url), 'utf8'))
  await pg.exec('grant usage on schema public,auth to authenticated,anon,service_role; grant select,insert,update,delete on public.journal to authenticated,anon,service_role;')
  await pg.query('insert into auth.users values($1)', [A])
  await pg.query("insert into journal(user_id,key,value) values($1,'pp:day:2024-02-29','{\"legacy\":true}')", [A])
  await pg.exec(await readFile(new URL('../supabase/migrations/20261014010000_journal_resource_limits.sql', import.meta.url), 'utf8'))
}
export async function runNamespaceChecks(pg, onPass = () => {}) {
  const migration = await readFile(new URL('../supabase/migrations/20261014030000_journal_key_namespace.sql', import.meta.url), 'utf8')
  const rollback = 'begin; alter table public.journal drop constraint ' + NAME + '; commit;'
  let passed = 0
  const check = async (name, fn) => { await fn(); passed++; onPass(name) }
  const rows = async () => (await pg.query('select user_id,key,value from journal order by user_id,key')).rows
  const usage = async () => ({ account: (await pg.query('select user_id,rows_used,bytes_used from journal_storage_usage order by user_id')).rows, project: (await pg.query('select bytes_used from journal_project_usage')).rows })
  const guards = async () => ({
    triggers: (await pg.query("select tgname,pg_get_triggerdef(oid) def from pg_trigger where tgrelid='journal'::regclass and not tgisinternal order by tgname")).rows,
    policies: (await pg.query("select policyname,qual,with_check from pg_policies where tablename='journal' order by policyname")).rows,
  })
  const originalRows = await rows(), originalGuards = await guards()
  await check('validated key CHECK preserves rows, quota, CAS and RLS', async () => {
    const beforeUsage = await usage()
    await pg.exec(migration)
    assert.deepEqual(await rows(), originalRows); assert.deepEqual(await usage(), beforeUsage)
    assert.deepEqual(await guards(), originalGuards)
    assert.equal((await pg.query('select convalidated from pg_constraint where conrelid=\'journal\'::regclass and conname=$1', [NAME])).rows[0].convalidated, true)
  })
  await check('valid legacy periods, year 0001..9999 and numeric flags are accepted', async () => {
    for (const key of acceptedNamespaceKeys) {
      const value = key === 'pp:pipAuto' ? 0 : key === 'pp:onboarded' ? 1 : { synthetic: true }
      await pg.query('insert into journal(user_id,key,value) values($1,$2,$3::jsonb)', [A, key, JSON.stringify(value)])
    }
    await pg.query("update journal set value='1'::jsonb where key='pp:pipAuto'")
    assert.equal((await pg.query("select value from journal where key='pp:pipAuto'")).rows[0].value, 1)
    assert.equal((await pg.query("select value from journal where key='pp:onboarded'")).rows[0].value, 1)
  })
  await check('reserved/unknown keys and impossible Gregorian dates are CHECK violations', async () => {
    for (const key of rejectedNamespaceKeys)
      await assert.rejects(pg.query('insert into journal(user_id,key,value) values($1,$2,\'{}\')', [A, key]), e => e.code === '23514' && e.constraint === NAME)
  })
  await check('authenticated own UID and bypass-RLS service role cannot insert reserved keys', async () => {
    for (const role of ['authenticated', 'service_role']) {
      await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [A])
      await pg.exec('set role ' + role)
      try { await assert.rejects(pg.query("insert into journal(user_id,key,value) values($1,'ppl:owner','1')", [A]), e => e.code === '23514' && e.constraint === NAME) }
      finally { await pg.exec('reset role;') }
    }
  })
  await check('one bad key in a batch rolls back all rows and quota counters', async () => {
    const before = await rows(), counters = await usage()
    await assert.rejects(pg.query("insert into journal(user_id,key,value) values($1,'pp:day:2099-01-01','{}'),($1,'pp:meta','{}')", [A]), e => e.code === '23514' && e.constraint === NAME)
    assert.deepEqual(await rows(), before); assert.deepEqual(await usage(), counters)
  })
  await check('rollback removes only CHECK and preserves accepted rows/counters/guards', async () => {
    const before = await rows(), counters = await usage()
    await pg.exec(rollback)
    assert.deepEqual(await rows(), before); assert.deepEqual(await usage(), counters); assert.deepEqual(await guards(), originalGuards)
    assert.equal((await pg.query('select count(*)::int n from pg_constraint where conrelid=\'journal\'::regclass and conname=$1', [NAME])).rows[0].n, 0)
  })
  await check('incompatible historical row aborts full migration and is retained unchanged', async () => {
    await pg.query("insert into journal(user_id,key,value) values($1,'pp:meta','{\"legacy\":true}')", [A])
    const before = await rows(), counters = await usage()
    await assert.rejects(pg.exec(migration), e => e.code === '23514' && e.constraint === NAME)
    await pg.exec('rollback;')
    assert.deepEqual(await rows(), before); assert.deepEqual(await usage(), counters); assert.deepEqual(await guards(), originalGuards)
    assert.equal((await pg.query('select count(*)::int n from pg_constraint where conrelid=\'journal\'::regclass and conname=$1', [NAME])).rows[0].n, 0)
  })
  return { passed, acceptedKeys: acceptedNamespaceKeys.length, rejectedKeys: rejectedNamespaceKeys.length, scope: 'SYNTHETIC_ONLY_ISOLATED_DATABASE' }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = new PGlite(); await pg.waitReady
  try {
    await setupNamespaceFixture(pg)
    const result = await runNamespaceChecks(pg, name => console.log('PASS ' + name))
    console.log(JSON.stringify(result))
  } finally { await pg.close() }
}
