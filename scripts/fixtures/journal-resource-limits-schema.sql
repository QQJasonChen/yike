-- Synthetic PostgreSQL baseline for quota tests only. Not an installation migration.
-- Production schema/trigger presence and definitions must be independently checked.

-- From frozen bd7f260: 20260612000000_journal.sql
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


-- From frozen bd7f260: 20260901010000_server_updated_at.sql
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


-- From frozen bd7f260: 20260903000000_journal_stale_write_guard.sql
-- 伺服器端的「過期寫入」護欄（Codex 上架前互審第 5 輪 P0-1／P0-2）。
--
-- 前一輪我把逾時從 Promise.race 改成 AbortController，宣稱「逾時會取消請求，
-- 所以舊的寫入不可能後到」。這句話對瀏覽器成立，對資料庫不成立：
-- 請求一旦進了 PostgREST／Postgres，client 斷線之後 backend 仍可能把它跑完並 commit。
-- 兩個分頁也各有各的記憶體佇列（syncChain 是 module-level），彼此完全不互斥。
-- 兩種情況都會讓「較舊的版本晚一步蓋掉較新的版本」，而本機的 dirty 已被清掉，
-- 那份較新的內容從此不會再被推上去。
--
-- 修法：每筆寫入帶上 client_id（裝置）與 client_rev（該裝置對該 key 的單調版號）。
-- 同一台裝置的版號倒退就整筆不寫，PostgREST 也不會把它列進 returning，
-- 前端因此不會清掉 dirty，下一次同步會用更高的版號重推。
--
-- 只擋「同一台裝置」。跨裝置不比版號——那是另一回事，由前端的衝突副本處理
-- （兩台都改過同一天時，雲端那份會另存成本機副本，不會無聲消失）。

alter table public.journal add column if not exists client_id text;
alter table public.journal add column if not exists client_rev bigint;

create or replace function public.journal_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and new.client_id is not null
     and old.client_id is not null
     and new.client_id = old.client_id
     and new.client_rev is not null
     and old.client_rev is not null
     and new.client_rev <= old.client_rev then
    return null; -- 同一台裝置的過期請求：整筆不寫，也不會出現在 returning 裡
  end if;
  -- updated_at 一律由伺服器決定。客戶端時鐘設錯不能污染排序基準。
  new.updated_at := now();
  return new;
end;
$$;


-- From frozen bd7f260: 20260903010000_journal_cas.sql
-- 跨裝置的 compare-and-set（Codex 上架前互審第 6 輪 P0-2）。
--
-- 上一支 migration 的 client_id/client_rev 只擋得住「同一台裝置的過期寫入」。
-- Codex 指出的破口是 A→B→A：那一列只記得「最後一個寫入者」的版號，
--   A pull 到 S0 → B 推 B1 → A 推 A1
-- 因為 client_id 不同，trigger 放行 A1，B 剛寫好的內容就這樣沒了；
-- 而 A 在 pull 的當下還看不到 B1，所以連衝突副本都留不下來。
--
-- 修法是不看裝置、只看「你是根據哪個版本改的」：
-- 客戶端送出它上次看到的 updated_at（base_updated_at），
-- 跟資料庫現值對不上就整筆不寫。前端因此不會清 dirty，
-- 下一輪會先 pull（這時看得到對方的版本，會留衝突副本）再重推。
--
-- 已知限制（誠實記錄）：base_updated_at 為 NULL 時放行。
-- 這是為了不讓還沒更新的舊 App／舊分頁完全推不上去——它們根本不送這個欄位。
-- 轉換期內舊客戶端仍是「後到者勝」；等使用者更新完就自然收斂。

alter table public.journal add column if not exists base_updated_at timestamptz;

create or replace function public.journal_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    -- ① compare-and-set：不分裝置。你根據的版本不是現在的版本 → 整筆不寫。
    if new.base_updated_at is not null and new.base_updated_at <> old.updated_at then
      return null;
    end if;
    -- ② 同一台裝置的過期請求（逾時後晚一步 commit、或另一個分頁的舊版本後到）。
    -- 用嚴格小於，不是小於等於：ON CONFLICT DO UPDATE 時，沒送這兩個欄位的舊客戶端
    -- new.client_rev 會等於 old.client_rev，用 <= 會把它們全部永久擋死。
    -- 真正的過期寫入版號一定嚴格較小（nextClientRev 是嚴格遞增的）。
    if new.client_id is not null
       and old.client_id is not null
       and new.client_id = old.client_id
       and new.client_rev is not null
       and old.client_rev is not null
       and new.client_rev < old.client_rev then
      return null;
    end if;
    -- 檢查完才清掉。**不能**在 INSERT 階段清：
    -- `insert … on conflict do update set … = excluded.…` 的 excluded 是
    -- BEFORE INSERT 觸發器跑完之後的那一列，提早清掉等於把要比對的值自己刪了，
    -- 護欄看起來有裝，實際永遠是 NULL、永遠放行（實測 A 的過期寫入照樣落庫）。
    new.base_updated_at := null; -- 只是這次請求的參數，不留在資料列裡
  end if;
  -- updated_at 一律由伺服器決定。客戶端時鐘設錯不能污染排序基準。
  new.updated_at := now();
  return new;
end;
$$;

