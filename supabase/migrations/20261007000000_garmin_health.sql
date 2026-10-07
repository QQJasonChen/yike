-- Garmin 官方 Health API 直連（見 docs/GARMIN-SETUP.md）
--
-- 資料流：使用者在 app 按「連結 Garmin」→ garmin-oauth 走 OAuth2 PKCE → 存 token 到 garmin_links
--         → Garmin 每次手錶同步就主動 POST 到 garmin-webhook → 依 Garmin userId 找到我們的使用者
--         → 原始摘要寫進 health_daily（每人每天一列，data = { 摘要類型: 原始物件 }）
--         → app 開啟時讀自己的 health_daily，在前端解析成每日指標（src/health.ts，解析只有一份）。
--
-- 注意：這條路的健康資料在伺服器上是明文（Garmin 推送無法端對端加密）；
-- 匯出檔匯入與 Apple 健康兩條路則跟日記一樣走 E2EE 同步。UI 有寫清楚。

-- 帳號連結：token 只有 service role（edge function）碰得到，使用者端連讀都不行
create table if not exists public.garmin_links (
  user_id uuid primary key references auth.users (id) on delete cascade,
  garmin_user_id text unique not null,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.garmin_links enable row level security;
-- 不建 policy = 一般使用者讀寫皆拒

-- OAuth PKCE 暫存（start → callback 之間，10 分鐘內有效）
create table if not exists public.garmin_pkce (
  state text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  verifier text not null,
  return_to text not null,
  created_at timestamptz not null default now()
);
alter table public.garmin_pkce enable row level security;

-- 每日健康摘要（原始 Garmin JSON，依類型合併）
create table if not exists public.health_daily (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.health_daily enable row level security;

drop policy if exists "health_daily_select_own" on public.health_daily;
create policy "health_daily_select_own" on public.health_daily
  for select using (auth.uid() = user_id);
drop policy if exists "health_daily_delete_own" on public.health_daily;
create policy "health_daily_delete_own" on public.health_daily
  for delete using (auth.uid() = user_id);

-- webhook 用：把一個摘要合併進那天的 data（同類型新的覆蓋舊的）
create or replace function public.health_daily_merge(p_user uuid, p_day date, p_patch jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.health_daily (user_id, day, data, updated_at)
  values (p_user, p_day, p_patch, now())
  on conflict (user_id, day) do update
    set data = public.health_daily.data || excluded.data, updated_at = now();
$$;
-- security definer 函式預設 PUBLIC 可執行——收回，只給 edge function（同 20260901000000 的教訓）
revoke execute on function public.health_daily_merge(uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.health_daily_merge(uuid, date, jsonb) to service_role;
