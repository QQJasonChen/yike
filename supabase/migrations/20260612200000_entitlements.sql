-- 付費白名單（Portaly webhook 寫入；activate function 讀取）
create table if not exists public.entitlements (
  email text primary key,
  source text not null default 'portaly', -- portaly / gumroad / manual
  raw jsonb, -- webhook 原始 payload（除錯用）
  redeemed_at timestamptz, -- 開通帳號的時間
  created_at timestamptz not null default now()
);

-- 只有 service role 能碰（edge functions 用），前端 anon 完全無權限
alter table public.entitlements enable row level security;
