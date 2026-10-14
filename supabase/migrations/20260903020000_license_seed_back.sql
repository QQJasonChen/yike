-- 把 Gumroad 的歷史使用次數重新算進額度（Codex 上架前互審第 6 輪 P1-1）。
--
-- 第 3 輪為了修「節流器視窗會過期」，把額度搬到永久表 license_redemptions；
-- 第 4 輪為了修並發，加上 advisory lock 並順手把 seed 參數拿掉。
-- 拿掉 seed 就等於忘記「這張序號在新表建立之前已經在 Gumroad 上用掉幾次」——
-- 新表是空的，所以一張已經開通過 2 次的序號還能再開 3 個。
-- 修並發的時候弄壞了額度，典型的「修 A 弄壞 B」。
--
-- 直覺解法 greatest(n, seed) 是錯的：Gumroad 的 uses 每次開通成功也會 +1，
-- 兩個計數器會互相追著跑，實測 seed=2/cap=3 時仍然放行第 4、第 5 個。
-- 正確的做法是把「上線前的歷史用量」固定下來：第一列兌換時把當下的 Gumroad
-- uses 記進 seed_at_insert，之後一律用 min(seed_at_insert) + 目前列數 當總量。
-- 這樣就算 Gumroad 那邊的計次失敗，額度也不會跟著失準。

alter table public.license_redemptions add column if not exists seed_at_insert int;
-- 舊列必須回填 0。留 null 的話 min(seed_at_insert) 是 null → pre 退回 coalesce(seed,0)，
-- 而 seed（Gumroad 的 uses）本來就已經包含那些舊列代表的用量：
-- 兩列舊兌換 + uses=2 → pre=2、n=3 → 2+3>3，合法的第三次會被誤拒
-- （Codex 互審第 7 輪 P1-14）。線上目前 0 列，這行是把邏輯缺口補掉。
update public.license_redemptions set seed_at_insert = 0 where seed_at_insert is null;

create or replace function public.license_redeem(k text, mail text, cap int, seed int default 0)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted boolean;
  n int;
  pre int;
begin
  perform pg_advisory_xact_lock(hashtext('lic:' || lower(k)));

  -- 這張序號在建表前的歷史用量（第一列寫進去之後就固定了）
  select min(seed_at_insert) into pre
    from public.license_redemptions where license_key = lower(k);
  pre := coalesce(pre, coalesce(seed, 0));

  insert into public.license_redemptions(license_key, email, seed_at_insert)
  values (lower(k), lower(mail), pre)
  on conflict (license_key, email) do nothing
  returning true into inserted;

  -- 這個 email 之前就兌換過 → 同一個人重來（換裝置、重設密碼），一律放行。
  if not coalesce(inserted, false) then
    return true;
  end if;

  select count(*) into n from public.license_redemptions where license_key = lower(k);
  if pre + n > cap then
    delete from public.license_redemptions
     where license_key = lower(k) and email = lower(mail);
    return false;
  end if;
  return true;
end;
$$;

revoke execute on function public.license_redeem(text, text, int, int) from public, anon, authenticated;
grant execute on function public.license_redeem(text, text, int, int) to service_role;
drop function if exists public.license_redeem(text, text, int);
