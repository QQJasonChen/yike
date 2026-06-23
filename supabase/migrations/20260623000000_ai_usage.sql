-- AI 用量上限：每位使用者每天計數，避免站方 OpenAI key 被濫用（站方付費）。
create table if not exists public.ai_usage (
  user_id uuid not null,
  day date not null default current_date,
  count int not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
-- 不建任何 policy = 一般使用者讀寫皆拒；只有 service role（edge function）能存取。

-- 原子遞增今日次數，回傳是否仍在上限內。
create or replace function public.ai_usage_bump(uid uuid, cap int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare c int;
begin
  insert into public.ai_usage(user_id, day, count) values (uid, current_date, 1)
  on conflict (user_id, day) do update set count = public.ai_usage.count + 1
  returning count into c;
  return c <= cap;
end;
$$;
