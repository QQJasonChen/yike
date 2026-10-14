-- Server-owned bounded storage. Staged; operator reviews capacity before applying.
-- Byte usage = UTF-8 key + canonical JSON text; this is NOT actual database disk size.
-- AFTER statement transition tables count only rows accepted by the existing CAS trigger.
begin;
-- Do not wait indefinitely behind live writers during the bounded backfill.
-- Operator first reviews metadata/capacity and retains an exact rollback.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.journal in share row exclusive mode;

create table public.journal_resource_limits (
  singleton boolean primary key default true check (singleton),
  max_key_bytes integer not null default 1024 check (max_key_bytes between 32 and 8192),
  max_value_bytes bigint not null default 524288 check (max_value_bytes between 1024 and 10485760),
  max_account_rows bigint not null default 40000 check (max_account_rows > 0),
  max_account_bytes bigint not null default 104857600 check (max_account_bytes > 0),
  max_project_bytes bigint not null default 262144000 check (max_project_bytes > 0)
);
insert into public.journal_resource_limits(singleton) values(true);
create table public.journal_storage_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  rows_used bigint not null check (rows_used >= 0),
  bytes_used bigint not null check (bytes_used >= 0)
);
create table public.journal_project_usage (
  singleton boolean primary key default true check(singleton),
  bytes_used bigint not null check(bytes_used >= 0)
);
insert into public.journal_storage_usage
select user_id,count(*),sum(octet_length(key)::bigint+octet_length(value::text)::bigint)
from public.journal group by user_id;
insert into public.journal_project_usage(singleton,bytes_used)
select true,coalesce(sum(octet_length(key)::bigint+octet_length(value::text)::bigint),0) from public.journal;

alter table public.journal_resource_limits enable row level security;
alter table public.journal_storage_usage enable row level security;
alter table public.journal_project_usage enable row level security;
-- Remove default grants as well: GRANT SELECT alone would not remove an ALL
-- grant inherited from the project's ALTER DEFAULT PRIVILEGES configuration.
revoke all on public.journal_resource_limits,public.journal_storage_usage,public.journal_project_usage from public,anon,authenticated,service_role;
grant select on public.journal_storage_usage to authenticated;
create policy "own usage select" on public.journal_storage_usage for select to authenticated using(auth.uid()=user_id);
grant select,update on public.journal_resource_limits to service_role;
grant select on public.journal_storage_usage,public.journal_project_usage to service_role;

create function public.journal_check_record_size() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare lim public.journal_resource_limits%rowtype;
begin
  select * into strict lim from public.journal_resource_limits where singleton;
  if octet_length(new.key)=0 or octet_length(new.key)>lim.max_key_bytes
     or octet_length(new.value::text)>lim.max_value_bytes
     or octet_length(coalesce(new.client_id,''))>256 then
    raise exception using errcode='23514',message='YIKE_JOURNAL_RECORD_LIMIT';
  end if;
  return new;
end;
$$;
-- Alphabetical order after the CAS trigger for direct UPDATE. ON CONFLICT first
-- checks the incoming INSERT size even if its UPDATE would later fail CAS.
create trigger z_journal_record_size before insert or update on public.journal
for each row execute function public.journal_check_record_size();

create function public.journal_account_storage() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  lim public.journal_resource_limits%rowtype;
  changes jsonb;
  d record;
  total_delta bigint;
  old_project bigint;
  old_rows bigint;
  old_bytes bigint;
  next_rows bigint;
  next_bytes bigint;
begin
  select * into strict lim from public.journal_resource_limits where singleton;
  if tg_op='INSERT' then
    select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into changes from
      (select user_id,count(*)::bigint dr,sum(octet_length(key)::bigint+octet_length(value::text)::bigint) db from new_rows group by user_id) q;
  elsif tg_op='DELETE' then
    select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into changes from
      (select user_id,-count(*)::bigint dr,-sum(octet_length(key)::bigint+octet_length(value::text)::bigint) db from old_rows group by user_id) q;
  else
    select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into changes from
      (select user_id,sum(dr)::bigint dr,sum(db)::bigint db from (
        select user_id,1::bigint dr,octet_length(key)::bigint+octet_length(value::text)::bigint db from new_rows
        union all
        select user_id,-1::bigint,-(octet_length(key)::bigint+octet_length(value::text)::bigint) from old_rows
      ) all_rows group by user_id) q;
  end if;
  select coalesce(sum(x.db),0) into total_delta from jsonb_to_recordset(changes) x(db bigint);
  -- Global lock before per-account locks serializes concurrent deltas without lost updates.
  select bytes_used into strict old_project from public.journal_project_usage where singleton for update;
  if old_project+total_delta>lim.max_project_bytes and total_delta>0 then
    raise exception using errcode='23514',message='YIKE_JOURNAL_CAPACITY_LIMIT';
  end if;
  update public.journal_project_usage set bytes_used=bytes_used+total_delta where singleton;
  for d in select * from jsonb_to_recordset(changes) x(user_id uuid,dr bigint,db bigint) order by user_id loop
    if tg_op<>'DELETE' then
      insert into public.journal_storage_usage values(d.user_id,0,0) on conflict(user_id) do nothing;
    end if;
    select rows_used,bytes_used into old_rows,old_bytes from public.journal_storage_usage where user_id=d.user_id for update;
    -- During auth.users cascade its usage row may already be deleted; global delta still applies.
    if not found then
      if tg_op='DELETE' then continue; end if;
      raise exception 'YIKE_JOURNAL_USAGE_MISSING';
    end if;
    next_rows:=old_rows+d.dr; next_bytes:=old_bytes+d.db;
    if (next_rows>lim.max_account_rows and d.dr>0) or (next_bytes>lim.max_account_bytes and d.db>0) then
      raise exception using errcode='23514',message='YIKE_JOURNAL_ACCOUNT_LIMIT';
    end if;
    update public.journal_storage_usage set rows_used=next_rows,bytes_used=next_bytes where user_id=d.user_id;
  end loop;
  return null;
end;
$$;
revoke all on function public.journal_check_record_size(),public.journal_account_storage() from public,anon,authenticated,service_role;
create trigger journal_storage_insert after insert on public.journal referencing new table as new_rows for each statement execute function public.journal_account_storage();
create trigger journal_storage_update after update on public.journal referencing old table as old_rows new table as new_rows for each statement execute function public.journal_account_storage();
create trigger journal_storage_delete after delete on public.journal referencing old table as old_rows for each statement execute function public.journal_account_storage();
-- TRUNCATE does not fire DELETE transition triggers. Reject the maintenance
-- shortcut rather than silently leaving quota counters inconsistent.
create function public.journal_reject_truncate() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  raise exception using errcode='23514',message='YIKE_JOURNAL_TRUNCATE_BLOCKED';
end;
$$;
revoke all on function public.journal_reject_truncate() from public,anon,authenticated,service_role;
create trigger journal_storage_no_truncate before truncate on public.journal
for each statement execute function public.journal_reject_truncate();
commit;
