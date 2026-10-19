// Real PostgreSQL engine and candidate SQL; synthetic identities, no network.
// Role/JWT claim setup models PostgREST, not Auth JWT cryptographic validation.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { setupNamespaceFixture } from './journal-key-namespace-test.mjs'

const pg = new PGlite()
const A = '00000000-0000-4000-8000-000000000001'
const B = '00000000-0000-4000-8000-000000000002'
let passed = 0
const check = async (name, fn) => { await fn(); passed++; console.log(`PASS ${name}`) }
const denied = (sql, args) => assert.rejects(pg.query(sql, args), error => error.code === '42501')
try {
  await setupNamespaceFixture(pg)
  await pg.exec(await readFile(new URL('../supabase/migrations/20261014020000_journal_security_defaults.sql', import.meta.url), 'utf8'))
  await pg.exec(await readFile(new URL('../supabase/migrations/20261014030000_journal_key_namespace.sql', import.meta.url), 'utf8'))
  await pg.query('insert into auth.users values($1)', [B])
  await pg.query("insert into journal(user_id,key,value) values($1,'pp:day:2026-10-18','{\"synthetic\":\"B private\"}')", [B])
  const original = (await pg.query('select user_id,key,value from journal order by user_id,key')).rows
  const counters = (await pg.query('select * from journal_project_usage')).rows
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [A])
  await pg.exec('set role authenticated')
  await check('A cannot select B journal even with exact UID and key', async () => {
    assert.deepEqual((await pg.query('select * from journal where user_id=$1', [B])).rows, [])
  })
  await check('A cannot insert into B namespace', () => denied("insert into journal(user_id,key,value) values($1,'pp:day:2026-10-19','{}')", [B]))
  await check('A cannot overwrite B using ON CONFLICT', () => denied("insert into journal(user_id,key,value) values($1,'pp:day:2026-10-18','{}') on conflict(user_id,key) do update set value=excluded.value", [B]))
  await check('A cannot update B journal', async () => {
    assert.deepEqual((await pg.query("update journal set value='{}' where user_id=$1 returning key", [B])).rows, [])
  })
  await check('A cannot delete B journal', async () => {
    assert.deepEqual((await pg.query('delete from journal where user_id=$1 returning key', [B])).rows, [])
  })
  await check('A cannot transfer own row to B UID', () => denied('update journal set user_id=$1 where user_id=$2', [B, A]))
  await check('A cannot read B usage or change quota/counters', async () => {
    assert.deepEqual((await pg.query('select * from journal_storage_usage where user_id=$1', [B])).rows, [])
    await denied('update journal_project_usage set bytes_used=0')
    await denied('update journal_resource_limits set max_project_bytes=999999999')
  })
  await pg.exec('reset role')
  await pg.query("select set_config('request.jwt.claim.sub','',false)")
  await pg.exec('set role anon')
  await check('anonymous role cannot read or mutate journal', async () => {
    assert.deepEqual((await pg.query('select * from journal')).rows, [])
    await denied("insert into journal(user_id,key,value) values($1,'pp:day:2026-10-19','{}')", [A])
    assert.deepEqual((await pg.query("update journal set value='{}' returning key")).rows, [])
    assert.deepEqual((await pg.query('delete from journal returning key')).rows, [])
  })
  await pg.exec('reset role')
  await check('all rejected attacks preserve victim data and exact global usage', async () => {
    assert.deepEqual((await pg.query('select user_id,key,value from journal order by user_id,key')).rows, original)
    assert.deepEqual((await pg.query('select * from journal_project_usage')).rows, counters)
  })
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [A])
  await pg.exec('set role authenticated')
  await check('legitimate own-account CRUD still works', async () => {
    await pg.query("insert into journal(user_id,key,value) values($1,'pp:day:2026-10-20','{}')", [A])
    assert.equal((await pg.query("update journal set value='{\"synthetic\":true}' where key='pp:day:2026-10-20' returning key")).rows.length, 1)
    assert.equal((await pg.query("delete from journal where key='pp:day:2026-10-20' returning key")).rows.length, 1)
  })
  console.log(JSON.stringify({ passed, scope: 'SYNTHETIC_PGLITE_SINGLE_CONNECTION', production: false, jwtVerification: 'not tested' }))
} finally { await pg.close() }
