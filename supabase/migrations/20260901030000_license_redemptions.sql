-- 序號兌換紀錄。額度是「總量」，不該用會週期重置的節流器來記
--（Codex 上架前互審第 3 輪 P1）：
--   * rate_limits 的視窗到期就重來，一年後同一組序號又多 3 次
--   * 上線前已在 Gumroad 用過 1–3 次的序號，換到新計數器等於再送 3 次
-- 改成一張永久表，每次成功開通留一列，用 (license_key, email) 去重
-- （同一人重開同一個 email 不算新增一次）。
create table if not exists public.license_redemptions (
  license_key text not null,
  email text not null,
  source text not null default 'gumroad',
  created_at timestamptz not null default now(),
  primary key (license_key, email)
);
alter table public.license_redemptions enable row level security;
-- 不建任何 policy = 只有 service role（edge function）能存取

-- 原子兌換：先寫入再數，超過上限就回 false（呼叫端負責回收剛建的帳號）。
-- seed 是這組序號在 Gumroad 上的既有使用次數，用來把歷史用量算進總量。
create or replace function public.license_redeem(
  k text, mail text, cap int, seed int default 0
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted boolean;
  n int;
begin
  insert into public.license_redemptions(license_key, email)
  values (lower(k), lower(mail))
  on conflict (license_key, email) do nothing
  returning true into inserted;

  -- 這個 email 之前就兌換過 → 是同一個人重來（換裝置、重設密碼），一律放行，
  -- 不佔新名額也不受 seed 影響。
  if not coalesce(inserted, false) then
    return true;
  end if;

  select count(*) into n from public.license_redemptions where license_key = lower(k);
  -- 既有 Gumroad 用量與本表可能重疊，取較大者當已用張數，寧可保守
  if greatest(n, seed) > cap then
    -- 超額：把剛剛那列收回去。留著的話計數會被「被拒絕的嘗試」灌水，
    -- 本人之後用同一個 email 重試反而被自己的失敗紀錄擋住
    -- （跟「重試被當成攻擊」是同一類錯誤）。
    delete from public.license_redemptions
     where license_key = lower(k) and email = lower(mail);
    return false;
  end if;
  return true;
end;
$$;

revoke execute on function public.license_redeem(text, text, int, int) from public, anon, authenticated;
grant execute on function public.license_redeem(text, text, int, int) to service_role;
