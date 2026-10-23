#!/usr/bin/env bash
# 出貨閘門：沒有通過六道檢查就不准出貨。
#
# 為什麼要有這支：「互審到 SHIP 才上架」如果只靠人（或 AI）記得，就一定會有
# 某個趕時間的晚上忘記。這支把它變成機械的——沒簽章就 exit 1。
#
# 用法：
#   bash scripts/ship-gate.sh              # 只檢查，不出貨
#   bash scripts/ship-gate.sh --ack        # 檢查通過後，簽下這個 commit 的互審放行
#   bash scripts/ship-gate.sh --require    # 出貨腳本呼叫這個：沒簽章直接 exit 1
#
# 簽章檔 .review-ack 記的是「哪一個 commit 被審過並放行」。
# 之後只要再有 commit，簽章就對不上——必須重審。這是刻意的。
#
# 它是**本機 token，不進 git**（在 .gitignore 裡）。理由：如果要求把它 commit，
# 那個 commit 自己就會改變 HEAD，簽章立刻對不上——雞生蛋，永遠放行不了。
# 耐久的審查紀錄放在 docs/REVIEW-*.md 與 commit message 裡，那才是給人看的；
# 這支檔案只負責「這台機器、這個 commit，剛剛真的過了閘」。
set -uo pipefail
export LC_ALL=${LC_ALL:-en_US.UTF-8}
# 字串裡的變數一律寫成 ${x} 而不是 ${x}：後面緊接中文標點時，某些 locale 下 bash 會把
# 那幾個位元組吃進變數名，變成 `acked?: unbound variable`——自測這支閘門時踩到的。
cd "$(dirname "$0")/.."

ACK_FILE=".review-ack"
MODE="${1:-check}"
fail=0
say() { printf '%s\n' "$*"; }
bad() { say "  ✗ $*"; fail=1; }
ok() { say "  ✓ $*"; }

HEAD_SHA=$(git rev-parse HEAD 2>/dev/null || echo unknown)

say "出貨閘門 — HEAD $HEAD_SHA"
say ""

# ── ① 工作區乾淨 ──────────────────────────────────────────────
say "① 工作區"
if [ -n "$(git status --porcelain)" ]; then
  bad "有未提交的改動——出貨的東西必須對得上某一個 commit"
  git status --short | sed 's/^/      /'
else
  ok "乾淨"
fi

# ── ② 測試 ───────────────────────────────────────────────────
say "② 測試"
if npm test --silent >/tmp/ship-gate-test.log 2>&1; then
  ok "$(grep -oE 'Tests +[0-9]+ passed' /tmp/ship-gate-test.log | tail -1)"
else
  bad "測試沒過（/tmp/ship-gate-test.log）"
  tail -12 /tmp/ship-gate-test.log | sed 's/^/      /'
fi

# ── ③ build（tsc -b + vite build）─────────────────────────────
# 注意：`npx tsc --noEmit` 不等於這道閘——build 用的 tsc -b 會檢查測試檔。
say "③ build"
if npm run build >/tmp/ship-gate-build.log 2>&1; then
  ok "build 通過"
else
  bad "build 失敗（/tmp/ship-gate-build.log）"
  tail -8 /tmp/ship-gate-build.log | sed 's/^/      /'
fi

# ── ④ lint（只擋 error，warning 不擋）────────────────────────
say "④ lint"
if npm run lint >/tmp/ship-gate-lint.log 2>&1; then
  ok "0 errors"
else
  bad "lint 有 error（/tmp/ship-gate-lint.log）"
fi

# ── ⑤ 憑證不准進 repo ────────────────────────────────────────
# 真實邀請碼曾經被寫進公開 repo 的測試檔一次（2026-09-01 因此輪替了邀請碼）。
#
# 這裡刻意**不**把「出現 eyJ… 或 service_role 這幾個字」當成洩漏：
#   - Supabase 的 anon key 是 publishable 的，本來就會進 bundle（src/cloudConfig.ts）。
#   - SQL 的 `grant execute … to service_role` 是角色名，不是金鑰。
# 判準要看實質：JWT 解出來的 role 是不是 service_role。
say "⑤ 憑證外洩掃描"
leak=""

# a) 明確格式的密鑰
# 測試用的假金鑰一律 `sk-fake-` 開頭。把約定變成機械的：不是 sk-fake- 的就擋。
# （不整個排除 src/__tests__/——真實邀請碼被寫進公開 repo 的測試檔正是發生過的事。）
hard=$(git grep -nIE 'sk-[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{8,}|YK[0-9A-F]{8}' -- \
  ':!*.md' ':!package-lock.json' ':!scripts/ship-gate.sh' 2>/dev/null | grep -v 'sk-fake-' || true)
[ -n "$hard" ] && leak="$hard"

# b) JWT：解 payload 看 role。anon 放行，其他一律擋。
while IFS= read -r hit; do
  [ -z "$hit" ] && continue
  jwt=$(printf '%s' "$hit" | grep -oE 'eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+' | head -1)
  [ -z "$jwt" ] && continue
  payload=${jwt#*.}
  # base64url → base64，補 padding
  b64=$(printf '%s' "$payload" | tr '_-' '/+')
  while [ $(( ${#b64} % 4 )) -ne 0 ]; do b64="${b64}="; done
  role=$(printf '%s' "$b64" | base64 -d 2>/dev/null | grep -oE '"role" *: *"[a-z_]+"' | head -1)
  case "$role" in
    *anon*) : ;; # publishable，放行
    *) leak="${leak}
${hit}   ← JWT role=${role:-未知}" ;;
  esac
done <<< "$(git grep -nIE 'eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+' -- ':!*.md' ':!package-lock.json' ':!scripts/ship-gate.sh' 2>/dev/null || true)"

if [ -n "$leak" ]; then
  bad "追蹤中的檔案裡有真的憑證："
  say "$leak" | grep -v '^$' | head -10 | sed 's/^/      /'
else
  ok "沒有掃到（anon key 是 publishable，不算）"
fi

# ── ⑤-b 靜態頁的 CSP 要跟行內 script 對得上 ─────────────────────
# public/ 的四頁不經過 vite 的 cspPlugin，各自有 hash 型的 CSP meta。
# 有人改了那段 script 一個空白，hash 就失效、頁面靜默壞掉（沒有錯誤畫面）。
say "⑤-b 靜態頁 CSP"
if node scripts/static-csp.mjs --check >/tmp/ship-gate-csp.log 2>&1; then
  ok "四頁的 hash 都對得上"
else
  bad "靜態頁 CSP 過期或缺少（跑 node scripts/static-csp.mjs 重算）"
  grep '✗' /tmp/ship-gate-csp.log | sed 's/^/      /'
fi

# ── ⑥ 線上資料庫實況 ─────────────────────────────────────────
# migration 與 edge function 都是手動套用的，「檔案說的」跟「線上跑的」對不上過兩次。
# 沒有 token／沒有網路就跳過（本機開發不該被卡住），但要說出來。
say "⑥ 線上資料庫實況"
if bash scripts/db-check.sh >/tmp/ship-gate-db.log 2>&1; then
  ok "$(grep -c '✓' /tmp/ship-gate-db.log) 項全過"
else
  code=$?
  if [ "$code" = "2" ]; then
    say "  · 跳過（沒有 Supabase token 或 project-ref）"
  else
    bad "線上狀態與程式的假設不一致（/tmp/ship-gate-db.log）"
    grep '✗' /tmp/ship-gate-db.log | sed 's/^/    /'
  fi
fi

# ── ⑦ 互審放行簽章 ───────────────────────────────────────────
say "⑦ 互審放行"
# 先給預設值：set -u 底下，只靠 `x=$(... || true)` 在某些 shell/locale 組合裡
# 仍可能留下未綁定的變數（自測時踩到 `acked: unbound variable`）。
acked=""
if [ -f "$ACK_FILE" ]; then
  acked=$(grep -E '^commit=' "$ACK_FILE" | cut -d= -f2- || true)
fi
if [ "$MODE" = "--ack" ]; then
  if [ "$fail" -ne 0 ]; then
    say "  ✗ 前面有沒過的檢查，不簽"
    exit 1
  fi
  {
    echo "# 互審放行簽章。有新 commit 就會失效——必須重審。"
    echo "commit=$HEAD_SHA"
    echo "date=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "by=${REVIEW_BY:-$(git config user.name)}"
    echo "note=${REVIEW_NOTE:-}"
  } > "$ACK_FILE"
  say "  ✓ 已簽 $HEAD_SHA"
  say ""
  say "${ACK_FILE} 不進 git（見檔頭說明）。再有新 commit 就會失效。"
  exit 0
fi

if [ "$acked" = "$HEAD_SHA" ]; then
  ok "已放行（$(grep -E '^date=' "$ACK_FILE" | cut -d= -f2-)）"
else
  if [ -z "$acked" ]; then
    bad "還沒有互審放行簽章"
  else
    bad "簽章是 ${acked}，不是現在的 HEAD——這之後的改動沒有被審過"
  fi
  say "      互審跑到雙方 SHIP 之後，執行：bash scripts/ship-gate.sh --ack"
fi

say ""
if [ "$fail" -ne 0 ]; then
  say "結論：不准出貨。"
  [ "$MODE" = "--require" ] && exit 1
  exit 1
fi
say "結論：可以出貨。"
