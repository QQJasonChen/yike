// Real PostgreSQL (WASM), synthetic data only; no network/credentials.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const pg = new PGlite()
await pg.waitReady
const A = '00000000-0000-4000-8000-000000000001'
const B = '00000000-0000-4000-8000-000000000002'
const C = '00000000-0000-4000-8000-000000000003'
let passed = 0
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`) }
async function fail(sql, args, pattern) {
  await assert.rejects(pg.query(sql, args), e => pattern.test(e.message))
}
const insert = (id, key, value) => pg.query('insert into public.journal(user_id,key,value) values($1,$2,$3::jsonb)', [id, key, JSON.stringify(value)])
const usage = async id => (await pg.query('select rows_used,bytes_used from public.journal_storage_usage where user_id=$1', [id])).rows[0]
const exact = async () => {
  const r = await pg.query(`select count(*) bad from (
    select coalesce(j.user_id,u.user_id) user_id from
    (select user_id,count(*)::bigint n,sum(octet_length(key)::bigint+octet_length(value::text)::bigint) b from public.journal group by user_id) j
    full join public.journal_storage_usage u on j.user_id=u.user_id
    where coalesce(j.n,0)<>coalesce(u.rows_used,0) or coalesce(j.b,0)<>coalesce(u.bytes_used,0)
  ) bad`)
  assert.equal(Number(r.rows[0].bad), 0)
  const g = await pg.query('select bytes_used,(select coalesce(sum(octet_length(key)::bigint+octet_length(value::text)::bigint),0) from public.journal) actual from public.journal_project_usage')
  assert.equal(String(g.rows[0].bytes_used), String(g.rows[0].actual))
}
try {
  await pg.exec(`create schema auth; create role anon; create role authenticated; create role service_role bypassrls;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`)
  // Production already has these fields/guards, but its migration history must
  // be verified separately. This fixture is synthetic test setup, never deploy.
  await pg.exec(await readFile(new URL('./fixtures/journal-resource-limits-schema.sql', import.meta.url), 'utf8'))
  await pg.exec('grant usage on schema public,auth to authenticated,anon,service_role; grant select,insert,update,delete on public.journal to authenticated,anon,service_role;')
  await pg.query('insert into auth.users values($1),($2),($3)', [A,B,C])
  await insert(A,'pp:before',{text:'existing data'})
  // Match projects that automatically grant newly created public tables ALL
  // to service_role. The migration must actively revoke excess default grants.
  await pg.exec('alter default privileges in schema public grant all on tables to service_role;')
  await test('backfill is exact and preserves existing rows', async () => {
    await pg.exec(await readFile(new URL('../supabase/migrations/20261014010000_journal_resource_limits.sql', import.meta.url), 'utf8'))
    await exact(); assert.equal(Number((await usage(A)).rows_used),1)
  })
  await pg.exec('update public.journal_resource_limits set max_account_rows=3,max_account_bytes=3000,max_project_bytes=5000,max_value_bytes=1024,max_key_bytes=32;')
  await test('bulk insertion and upsert deltas do not double count', async () => {
    await pg.query(`insert into public.journal(user_id,key,value) values($1,'x','1'),($1,'y','2')`,[A])
    await pg.query(`insert into public.journal(user_id,key,value) values($1,'x','{"text":"changed"}') on conflict(user_id,key) do update set value=excluded.value`,[A])
    await exact(); assert.equal(Number((await usage(A)).rows_used),3)
  })
  await test('row limit rolls back full batch and global counter', async () => {
    await fail(`insert into public.journal(user_id,key,value) values($1,'new-a','1'),($2,'other-b','1')`,[A,B],/YIKE_JOURNAL_ACCOUNT_LIMIT/)
    assert.equal((await pg.query(`select key from public.journal where key in ('new-a','other-b')`)).rows.length,0); await exact()
  })
  await test('oversized key, JSON and client identifier fail closed', async () => {
    await fail('insert into public.journal(user_id,key,value) values($1,$2,\'1\')',[B,'k'.repeat(33)],/YIKE_JOURNAL_RECORD_LIMIT/)
    await fail('insert into public.journal(user_id,key,value) values($1,\'big\',$2::jsonb)',[B,JSON.stringify('中'.repeat(500))],/YIKE_JOURNAL_RECORD_LIMIT/)
    await fail(`insert into public.journal(user_id,key,value,client_id) values($1,'bad-device','1',$2)`,[B,'c'.repeat(257)],/YIKE_JOURNAL_RECORD_LIMIT/); await exact()
  })
  await test('stale CAS rejection does not leak counter usage', async () => {
    const before = await usage(A)
    const r = await pg.query(`update public.journal set value='{"text":"stale"}',base_updated_at='2000-01-01T00:00:00Z' where user_id=$1 and key='x' returning *`,[A])
    assert.equal(r.rows.length,0); assert.deepEqual(await usage(A),before); await exact()
  })
  await test('stale ON CONFLICT preserves data/counters; oversized incoming row fails before CAS', async () => {
    const before = await usage(A)
    const sql = `insert into public.journal(user_id,key,value,base_updated_at) values($1,'x',$2::jsonb,'2000-01-01T00:00:00Z') on conflict(user_id,key) do update set value=excluded.value,base_updated_at=excluded.base_updated_at returning key`
    assert.equal((await pg.query(sql,[A,JSON.stringify('stale')])).rows.length,0)
    await fail(sql,[A,JSON.stringify('z'.repeat(1100))],/YIKE_JOURNAL_RECORD_LIMIT/)
    assert.deepEqual(await usage(A),before); await exact()
  })
  await test('account bytes limit rolls back writes and allows smaller correction', async () => {
    await insert(B,'one','a'.repeat(990)); await insert(B,'two','b'.repeat(990))
    await pg.exec('update public.journal_resource_limits set max_account_bytes=2500;')
    await fail(`insert into public.journal(user_id,key,value) values($1,'three',$2::jsonb)`,[B,JSON.stringify('c'.repeat(990))],/YIKE_JOURNAL_ACCOUNT_LIMIT/)
    await pg.exec('update public.journal_resource_limits set max_account_bytes=1000;')
    await pg.query(`update public.journal set value='1' where user_id=$1 and key='one'`,[B]); await exact()
    await pg.exec('update public.journal_resource_limits set max_account_bytes=3000;')
  })
  await test('project cap is global across owners with atomic rollback', async () => {
    const total = Number((await pg.query('select bytes_used from public.journal_project_usage')).rows[0].bytes_used)
    await pg.query('update public.journal_resource_limits set max_project_bytes=$1',[total+10])
    await fail(`insert into public.journal(user_id,key,value) values($1,'global',$2::jsonb)`,[C,JSON.stringify('large'.repeat(100))],/YIKE_JOURNAL_CAPACITY_LIMIT/)
    assert.equal((await pg.query('select * from public.journal where user_id=$1',[C])).rows.length,0); await exact()
    await pg.exec('update public.journal_resource_limits set max_project_bytes=5000;')
  })
  await test('usage is own-account read only and RPCs cannot bypass', async () => {
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[A]); await pg.exec('set role authenticated;')
    assert.equal((await pg.query('select user_id from public.journal_storage_usage')).rows.length,1)
    await fail('update public.journal_storage_usage set bytes_used=0',[],/permission denied/)
    await fail('update public.journal_resource_limits set max_account_bytes=999999999',[],/permission denied/)
    await fail('select public.journal_account_storage()',[],/permission denied/)
    await fail(`insert into public.journal(user_id,key,value) values($1,'stolen','1')`,[B],/row-level security/)
    await pg.exec('reset role;'); await exact()
  })
  await test('anonymous reads and writes cannot view counters or quota settings', async () => {
    await pg.exec('set role anon;')
    await fail('select * from public.journal_storage_usage',[],/permission denied/)
    await fail('select * from public.journal_resource_limits',[],/permission denied/)
    await pg.exec('reset role;')
  })
  await test('service-role restores enforce storage limits without editable counter shortcuts', async () => {
    await pg.exec('set role service_role;')
    await insert(C,'restore','safe')
    await fail('update public.journal_project_usage set bytes_used=0',[],/permission denied/)
    await fail('delete from public.journal_storage_usage',[],/permission denied/)
    await fail('truncate public.journal_storage_usage',[],/permission denied/)
    await fail('insert into public.journal_project_usage values(false,0)',[],/permission denied/)
    await fail('delete from public.journal_resource_limits',[],/permission denied/)
    await fail('insert into public.journal_resource_limits(singleton) values(false)',[],/permission denied/)
    await fail('insert into public.journal(user_id,key,value) values($1,\'oversized\',$2::jsonb)',[C,JSON.stringify('z'.repeat(1100))],/YIKE_JOURNAL_RECORD_LIMIT/)
    await pg.exec('reset role;'); await exact()
  })
  await test('already-over-limit data allows unchanged writes and reduction, never silent deletion', async () => {
    const beforeRows = (await pg.query('select count(*) n from public.journal')).rows[0].n
    await pg.exec('update public.journal_resource_limits set max_account_rows=1,max_account_bytes=1,max_project_bytes=1;')
    await pg.query('update public.journal set value=value where user_id=$1 and key=\'restore\'',[C])
    assert.equal((await pg.query('select count(*) n from public.journal')).rows[0].n,beforeRows)
    await exact()
    await pg.query('delete from public.journal where user_id=$1 and key=\'restore\'',[C]); await exact()
    await pg.exec('update public.journal_resource_limits set max_account_rows=3,max_account_bytes=3000,max_project_bytes=5000;')
  })
  await test('admin TRUNCATE fails closed without losing journal or counter state', async () => {
    const beforeRows = (await pg.query('select count(*) n from public.journal')).rows[0].n
    await fail('truncate public.journal',[],/YIKE_JOURNAL_TRUNCATE_BLOCKED/)
    assert.equal((await pg.query('select count(*) n from public.journal')).rows[0].n,beforeRows)
    await exact()
  })
  await test('journal deletion and Auth deletion cascade rebuild exact counters', async () => {
    await pg.query('delete from public.journal where user_id=$1 and key=\'x\'',[A]); await exact()
    await pg.query('delete from auth.users where id=$1',[B]); await exact()
    assert.equal((await pg.query('select * from public.journal_storage_usage where user_id=$1',[B])).rows.length,0)
  })
  await test('quota rollback removes only quota objects and preserves journal plus CAS/RLS', async () => {
    const before = (await pg.query('select * from public.journal order by user_id,key')).rows
    const policies = (await pg.query("select policyname,qual,with_check from pg_policies where schemaname='public' and tablename='journal' order by policyname")).rows
    await pg.exec(`begin; lock table public.journal in share row exclusive mode;
      drop trigger journal_storage_no_truncate on public.journal;
      drop trigger journal_storage_insert on public.journal;
      drop trigger journal_storage_update on public.journal;
      drop trigger journal_storage_delete on public.journal;
      drop trigger z_journal_record_size on public.journal;
      drop function public.journal_reject_truncate();
      drop function public.journal_account_storage();
      drop function public.journal_check_record_size();
      drop table public.journal_storage_usage,public.journal_project_usage,public.journal_resource_limits;
      commit;`)
    assert.deepEqual((await pg.query('select * from public.journal order by user_id,key')).rows,before)
    assert.deepEqual((await pg.query("select policyname,qual,with_check from pg_policies where schemaname='public' and tablename='journal' order by policyname")).rows,policies)
    assert.equal((await pg.query("select relrowsecurity from pg_class where oid='public.journal'::regclass")).rows[0].relrowsecurity,true)
    const stale = await pg.query(`update public.journal set value='"stale-after-rollback"',base_updated_at='2000-01-01T00:00:00Z' where user_id=$1 and key='y' returning key`,[A])
    assert.equal(stale.rows.length,0)
    assert.deepEqual((await pg.query('select * from public.journal order by user_id,key')).rows,before)
  })
  console.log(JSON.stringify({passed,engine: (await pg.query('select version()')).rows[0].version,production:false,multi_session_concurrency:'not tested - PGlite serializes its single connection'}))
} finally { await pg.close() }
