-- 給 AI 助理的唯讀存取 token（QQ 2026-10-22 拍板：先做唯讀）。
--
-- 設計：
--   * 只存 sha256 hash；明文只在產生那一刻顯示一次。資料庫被讀走也拿不到可用的 token。
--   * scope 目前只允許 'read'。寫入要走現有同步協定（client_id / base_updated_at），
--     否則會蓋掉手機上剛打的字——等唯讀版跑過真人再開。
--   * RLS：使用者只看得到、建得了、撤得了自己的；edge function 用 service role 查 hash。
--   * 撤銷＝填 revoked_at，不刪列（留下「哪個 token 什麼時候給過誰」的紀錄）。
create table if not exists public.agent_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  label text not null default '',
  scope text not null default 'read' check (scope in ('read')),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists agent_tokens_user_idx on public.agent_tokens (user_id);

alter table public.agent_tokens enable row level security;

drop policy if exists "own tokens select" on public.agent_tokens;
create policy "own tokens select" on public.agent_tokens
  for select using (auth.uid() = user_id);

-- 建立：只能建自己的，而且 scope 只能是 read（check 也擋，這裡是第二道）
drop policy if exists "own tokens insert" on public.agent_tokens;
create policy "own tokens insert" on public.agent_tokens
  for insert with check (auth.uid() = user_id and scope = 'read');

-- 更新：只能動自己的。前端只會寫 revoked_at；就算改了別的欄位也只影響自己。
drop policy if exists "own tokens update" on public.agent_tokens;
create policy "own tokens update" on public.agent_tokens
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own tokens delete" on public.agent_tokens;
create policy "own tokens delete" on public.agent_tokens
  for delete using (auth.uid() = user_id);

-- anon 不准碰（RLS 之外再收一層；authenticated 走上面的 policy）
revoke all on public.agent_tokens from anon;
grant select, insert, update, delete on public.agent_tokens to authenticated;
