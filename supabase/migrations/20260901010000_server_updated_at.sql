-- updated_at 改由伺服器決定，不接受客戶端送來的值。
--
-- 為什麼：同步原本把裝置自己的時鐘寫進 updated_at，伺服器照單全收。
-- 裝置時鐘快了（手動設錯、時區、電池沒電重置）→ 它寫的列拿到未來時間戳 →
-- 之後正常裝置的編輯永遠推不上去，使用者會看到自己寫的東西一直消失，且沒有任何錯誤。
-- 同時這也修掉「兩台裝置同時 pull，較慢完成的那台用較舊的內容覆蓋較新的列」。
-- 時間戳是排序基準，基準必須來自單一可信時鐘＝資料庫。
create or replace function public.journal_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists journal_touch_updated_at on public.journal;
create trigger journal_touch_updated_at
  before insert or update on public.journal
  for each row execute function public.journal_set_updated_at();
