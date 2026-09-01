-- rate_limits 的清理改用真正的到期時間。
--
-- 原本寫 `delete ... where window_start < now() - interval '2 days'`，那是假設
-- 所有視窗都只有一小時。序號額度改用一年視窗之後就爆了：window_start 是年度
-- 視窗的起點（可能是好幾個月前），所以剛 insert 的那一列會被同一次呼叫的
-- 清理立刻刪掉，每次都重新從 c=1 開始——原子額度形同虛設。
-- 實測：cap=3 連打 6 次全部回 true，資料表 0 列。
-- （Codex 上架前互審第 2 輪 P0）
alter table public.rate_limits add column if not exists expires_at timestamptz;

create or replace function public.rate_limit_bump(k text, cap int, window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  w timestamptz;
  c int;
begin
  w := to_timestamp(floor(extract(epoch from now()) / window_seconds) * window_seconds);
  insert into public.rate_limits(bucket, window_start, count, expires_at)
  values (k, w, 1, w + make_interval(secs => window_seconds))
  on conflict (bucket, window_start)
    do update set count = public.rate_limits.count + 1
  returning count into c;
  -- 只刪真正過期的視窗，不再用「兩天前」這種對短視窗才成立的近似
  delete from public.rate_limits
   where expires_at is not null and expires_at < now();
  return c <= cap;
end;
$$;

revoke execute on function public.rate_limit_bump(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_bump(text, int, int) to service_role;
