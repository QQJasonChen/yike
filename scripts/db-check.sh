#!/usr/bin/env bash
# 線上資料庫實況檢查——不看 migration 檔，直接問 production。
#
# 為什麼要有這支：這個專案的 migration 與 edge function **全部是手動套用的**
# （沒有 CI），而「檔案說的」跟「線上跑的」在一次互審裡對不上過兩次：
#   ① migration 改的是 journal_touch_updated_at，線上觸發器實際執行的函式叫
#      journal_set_updated_at——改了一個沒人呼叫的東西，測試卻是綠的。
#   ② compare-and-set 護欄整條是啞的：我在 INSERT 分支把 base_updated_at 清成 null，
#      而 ON CONFLICT DO UPDATE 的 `excluded` 是 BEFORE INSERT 跑完之後的列，
#      於是比對永遠看到 NULL、永遠放行。線上實測才發現。
# 結論：**部署宣稱一律要有線上查詢當證據。**
#
# 用法：bash scripts/db-check.sh
# 需要 Supabase 的 Management API token（存在 macOS 鑰匙圈裡，跟 CLI 共用）。
set -uo pipefail
export LC_ALL=${LC_ALL:-en_US.UTF-8}
cd "$(dirname "$0")/.."

REF=$(cat supabase/.temp/project-ref 2>/dev/null || echo "")
[ -z "$REF" ] && { echo "找不到 supabase/.temp/project-ref"; exit 2; }
TOK=$(security find-generic-password -s "Supabase CLI" -a "supabase" -w 2>/dev/null | sed 's/^go-keyring-base64://' | base64 -d)
if [ -z "${TOK:-}" ]; then echo "鑰匙圈裡沒有 Supabase CLI token"; exit 2; fi

fail=0
q() { # $1 = SQL；回傳 JSON
  curl -s -X POST "https://api.supabase.com/v1/projects/${REF}/database/query" \
    -H "Authorization: Bearer ${TOK}" -H "Content-Type: application/json" \
    --data-binary @- <<< "{\"query\":\"$1\"}"
}
check() { # $1=說明  $2=SQL（回一列一欄）  $3=期望值
  local got
  got=$(q "$2" | python3 -c 'import json,sys
try:
  d=json.load(sys.stdin)
  print("" if not d else list(d[0].values())[0])
except Exception as e:
  print("查詢失敗:"+str(e))')
  if [ "$got" = "$3" ]; then
    printf '  ✓ %s\n' "$1"
  else
    printf '  ✗ %s\n      期望 %s，實際 %s\n' "$1" "$3" "$got"
    fail=1
  fi
}

echo "線上資料庫實況檢查 — project ${REF}"
echo ""

echo "① journal 的同步護欄"
check "三個護欄欄位都在（client_id / client_rev / base_updated_at）" \
  "select count(*)::text from information_schema.columns where table_schema='public' and table_name='journal' and column_name in ('client_id','client_rev','base_updated_at')" "3"
check "觸發器綁的是實際存在的那支函式（BEFORE INSERT OR UPDATE）" \
  "select count(*)::text from pg_trigger t where t.tgrelid='public.journal'::regclass and not t.tgisinternal and pg_get_triggerdef(t.oid) like '%BEFORE INSERT OR UPDATE%journal_set_updated_at()%'" "1"
check "CAS 比對存在（base_updated_at <> old.updated_at 就整列跳過）" \
  "select case when pg_get_functiondef(p.oid) like '%new.base_updated_at is not null%old.updated_at%return null%' then 'yes' else 'no' end from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='journal_set_updated_at'" "yes"
check "清 base_updated_at 只在 UPDATE 分支（在 INSERT 分支清會讓 CAS 整條變啞）" \
  "select case when pg_get_functiondef(p.oid) ~ 'tg_op = ''UPDATE''(.|\\n)*new.base_updated_at := null' then 'yes' else 'no' end from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='journal_set_updated_at'" "yes"
check "(user_id, key) 有唯一性——新 key 走 insert 靠它擋併發新增" \
  "select count(*)::text from pg_constraint where conrelid='public.journal'::regclass and contype in ('p','u') and pg_get_constraintdef(oid) like '%(user_id, key)%'" "1"
check "沒有殘留的 base_updated_at（哨兵或卡住的 CAS 都會留下非 NULL）" \
  "select count(*)::text from public.journal where base_updated_at is not null" "0"
check "RLS 開著" \
  "select relrowsecurity::text from pg_class where oid='public.journal'::regclass" "true"

echo ""
echo "② 序號額度"
check "license_redeem 只有 4 參數版（舊的 3 參數版必須已 drop）" \
  "select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='license_redeem'" "1"
check "4 參數版帶一個預設值（讓舊版 edge function 的 3 參數呼叫仍解析得到）" \
  "select pronargdefaults::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='license_redeem'" "1"
check "有 advisory lock（同一組序號的併發兌換要序列化）" \
  "select case when pg_get_functiondef(p.oid) like '%pg_advisory_xact_lock%' then 'yes' else 'no' end from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='license_redeem'" "yes"
check "seed_at_insert 欄位存在" \
  "select count(*)::text from information_schema.columns where table_schema='public' and table_name='license_redemptions' and column_name='seed_at_insert'" "1"
check "沒有 seed_at_insert 為 NULL 的列（會讓合法的第三次兌換被誤拒）" \
  "select count(*)::text from public.license_redemptions where seed_at_insert is null" "0"

echo ""
echo "③ RPC 只給 service_role"
for fn in license_redeem license_force_record rate_limit_bump ai_usage_bump; do
  check "${fn} 沒有給 public/anon/authenticated" \
    "select case when has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') then 'leaked' else 'ok' end from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='${fn}'" "ok"
done

echo ""
echo "④ edge function"
ver=$(curl -s "https://api.supabase.com/v1/projects/${REF}/functions/activate" \
  -H "Authorization: Bearer ${TOK}" \
  | python3 -c 'import json,sys
d = json.load(sys.stdin)
print(d.get("status"), "v" + str(d.get("version")), "verify_jwt=" + str(d.get("verify_jwt")))' 2>/dev/null || echo "查不到")
echo "  · activate: ${ver}"
case "${ver}" in
  "ACTIVE"*"verify_jwt=False") printf '  ✓ %s\n' "ACTIVE 且 verify_jwt=False（它是未登入就能打的開通端點）" ;;
  *) printf '  ✗ %s\n' "activate 的狀態不對：${ver}"; fail=1 ;;
esac
echo "    （版號要自己對得上最後一次部署——這支查不出「原始碼是不是你手上這份」）"

echo ""
if [ "$fail" -ne 0 ]; then
  echo "結論：線上狀態與程式的假設不一致。修好再談出貨。"
  exit 1
fi
echo "結論：線上狀態符合程式的假設。"
