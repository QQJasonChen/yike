-- InkDay 雲端同步資料表（在 Supabase Dashboard → SQL Editor 貼上執行一次）
create table if not exists public.journal (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.journal enable row level security;

-- 每個用戶只能讀寫自己的資料
create policy "own rows select" on public.journal
  for select using (auth.uid() = user_id);
create policy "own rows insert" on public.journal
  for insert with check (auth.uid() = user_id);
create policy "own rows update" on public.journal
  for update using (auth.uid() = user_id);
create policy "own rows delete" on public.journal
  for delete using (auth.uid() = user_id);
