-- 開通端點的節流。存在的理由：activate 是唯一對外開放、不需登入、且會
-- 觸發外部 API（Gumroad 驗證）與建立帳號的入口。沒有節流時：
--   1. 拿到共用邀請碼的人可以寫腳本無限開帳號，每個帳號每天 15 次 AI，燒站方的 OpenAI key
--   2. Gumroad 序號可被無限暴力猜（而且每次命中還會消耗該序號的啟用次數）
--   3. 409/403 的差異會洩漏哪些 email 已經有帳號
-- 固定視窗計數，夠簡單也夠用；狀態放 DB 而不是記憶體，因為 edge function 是無狀態的。
create table if not exists public.rate_limits (
  bucket text not null,              -- 'act:ip:1.2.3.4' / 'act:email:foo@bar.com'
  window_start timestamptz not null,
  count int not null default 0,
  primary key (bucket, window_start)
);
alter table public.rate_limits enable row level security;
-- 不建任何 policy = 一般使用者讀寫皆拒；只有 service role（edge function）能存取。

-- 原子遞增並回報是否仍在額度內。先加再判斷，所以「剛好用完」那一次也會被擋，
-- 不會出現查了還有額度、實際已被別的請求用掉的時間差（影片講的 race condition）。
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
  insert into public.rate_limits(bucket, window_start, count) values (k, w, 1)
  on conflict (bucket, window_start) do update set count = public.rate_limits.count + 1
  returning count into c;
  -- 順手清掉兩天前的舊視窗，不必另外排程
  delete from public.rate_limits where window_start < now() - interval '2 days';
  return c <= cap;
end;
$$;
