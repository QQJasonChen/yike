-- Dormant server-paid AI only; browser BYOK is unaffected.
-- No budgets/prices are inferred. An owner must independently verify the model,
-- conservative token price upper bounds, budgets and expiry before opting in.
-- unit = nano-USD (1 USD = 1,000,000,000 units). This controls our reservation
-- estimate; it is not a provider-enforced billing/spend cap.
create table public.ai_proxy_config (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  contract text,
  model text,
  input_nano_usd_per_token bigint,
  output_nano_usd_per_token bigint,
  daily_request_cap integer,
  daily_budget_units bigint,
  lifetime_request_cap bigint,
  lifetime_budget_units bigint,
  user_daily_request_cap integer,
  valid_until timestamptz
);
insert into public.ai_proxy_config(singleton) values(true);
create table public.ai_proxy_global_usage (
  singleton boolean primary key default true check (singleton),
  requests bigint not null default 0 check (requests >= 0),
  reserved_units bigint not null default 0 check (reserved_units >= 0)
);
insert into public.ai_proxy_global_usage(singleton) values(true);
create table public.ai_proxy_daily_usage (
  day date primary key,
  requests bigint not null check (requests >= 0),
  reserved_units bigint not null check (reserved_units >= 0)
);
create table public.ai_proxy_user_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  requests integer not null check (requests >= 0),
  primary key(user_id, day)
);
alter table public.ai_proxy_config enable row level security;
alter table public.ai_proxy_global_usage enable row level security;
alter table public.ai_proxy_daily_usage enable row level security;
alter table public.ai_proxy_user_usage enable row level security;
-- No policies and no direct grants, including service_role: only the owner can
-- change configuration/usage; the server gets a narrow reservation RPC.
revoke all on public.ai_proxy_config, public.ai_proxy_global_usage,
  public.ai_proxy_daily_usage, public.ai_proxy_user_usage from public, anon, authenticated, service_role;

create function public.ai_proxy_reserve(uid uuid, contract text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  cfg public.ai_proxy_config%rowtype;
  total public.ai_proxy_global_usage%rowtype;
  daily public.ai_proxy_daily_usage%rowtype;
  user_requests integer;
  units bigint;
  reserved_at timestamptz;
  today date;
  denied jsonb := jsonb_build_object('contract','yike-ai-proxy-v1','allowed',false,'reason','config');
begin
  -- Lock order is always config then singleton global. The singleton serializes
  -- all global+daily+per-user reservations in one transaction across DB sessions.
  select * into cfg from public.ai_proxy_config where singleton for share;
  if not found or not cfg.enabled then return denied; end if;
  if contract is distinct from 'yike-ai-proxy-v1'
     or cfg.contract is distinct from 'yike-ai-proxy-v1'
     or cfg.model is distinct from 'gpt-4o-mini-2024-07-18'
     or cfg.valid_until is null or not isfinite(cfg.valid_until)
     or cfg.valid_until <= clock_timestamp()
     -- Require frequent re-verification rather than an indefinite opt-in.
     or cfg.valid_until > clock_timestamp() + interval '31 days'
     or cfg.input_nano_usd_per_token is null or cfg.input_nano_usd_per_token not between 1 and 1000000000
     or cfg.output_nano_usd_per_token is null or cfg.output_nano_usd_per_token not between 1 and 1000000000
     or cfg.daily_request_cap is null or cfg.daily_request_cap not between 1 and 100000
     or cfg.daily_budget_units is null or cfg.daily_budget_units not between 1 and 1000000000000000
     or cfg.lifetime_request_cap is null or cfg.lifetime_request_cap not between 1 and 1000000000
     or cfg.lifetime_budget_units is null or cfg.lifetime_budget_units not between 1 and 1000000000000000000
     or cfg.user_daily_request_cap is null or cfg.user_daily_request_cap not between 1 and 15
     or cfg.daily_request_cap > cfg.lifetime_request_cap
     or cfg.daily_budget_units > cfg.lifetime_budget_units
     or uid is null or not exists(select 1 from auth.users u where u.id=uid)
  then return denied; end if;
  -- Fixed handler contract: <=32,768 serialized UTF-8 input bytes + 1,024
  -- framing-token allowance, <=700 output tokens, one fixed model, no tools.
  -- Do not refund failed/timed-out attempts: the provider may have charged them.
  units := 33792::bigint * cfg.input_nano_usd_per_token + 700::bigint * cfg.output_nano_usd_per_token;
  select * into total from public.ai_proxy_global_usage where singleton for update;
  if not found then return denied; end if;
  -- A statement can wait for this lock across expiry or the UTC day boundary.
  -- Recheck the lease and choose its ledger day using the wall clock after locking.
  reserved_at := clock_timestamp();
  if cfg.valid_until <= reserved_at then return denied; end if;
  today := (reserved_at at time zone 'UTC')::date;
  select * into daily from public.ai_proxy_daily_usage where day=today;
  select requests into user_requests from public.ai_proxy_user_usage where user_id=uid and day=today;
  if total.requests >= cfg.lifetime_request_cap
     or total.reserved_units > cfg.lifetime_budget_units - units
     or coalesce(daily.requests,0) >= cfg.daily_request_cap
     or coalesce(daily.reserved_units,0) > cfg.daily_budget_units - units
     or coalesce(user_requests,0) >= cfg.user_daily_request_cap
  then return jsonb_build_object('contract','yike-ai-proxy-v1','allowed',false,'reason','quota'); end if;
  update public.ai_proxy_global_usage set requests=requests+1, reserved_units=reserved_units+units where singleton;
  insert into public.ai_proxy_daily_usage(day, requests, reserved_units) values(today,1,units)
    on conflict(day) do update set requests=ai_proxy_daily_usage.requests+1, reserved_units=ai_proxy_daily_usage.reserved_units+excluded.reserved_units;
  insert into public.ai_proxy_user_usage(user_id,day,requests) values(uid,today,1)
    on conflict(user_id,day) do update set requests=ai_proxy_user_usage.requests+1;
  return jsonb_build_object('contract','yike-ai-proxy-v1','allowed',true,'reserved_units',units);
end;
$$;
revoke all on function public.ai_proxy_reserve(uuid,text) from public, anon, authenticated;
grant execute on function public.ai_proxy_reserve(uuid,text) to service_role;

-- Old deployed code must fail closed rather than bypass global reservations.
-- Preserve legacy rows for audit; do not retroactively alter previous usage.
create or replace function public.ai_usage_bump(uid uuid, cap int)
returns boolean language sql security definer set search_path = pg_catalog, public
as $$ select false $$;
revoke all on function public.ai_usage_bump(uuid,int) from public, anon, authenticated, service_role;
