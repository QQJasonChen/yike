#!/usr/bin/env bash
# 建置 → 起 preview → 跑 scripts/ui-probe.mjs → 一定關掉 preview（trap）
set -uo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-4180}"
# 別的工作樹的舊 preview 占著這個 port 時，探針會去驗那台舊的而且全綠（Codex 第 3 輪 #5）
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $PORT 已被占用（可能是別的工作樹的 preview）。先關掉它，或用 PORT=xxxx 重跑。"
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN | tail -n +2
  exit 1
fi
npm run build >/tmp/ui-probe-build.log 2>&1 || { echo "build 失敗（/tmp/ui-probe-build.log）"; exit 1; }
npx vite preview --port "$PORT" --strictPort >/dev/null 2>&1 &
PID=$!
trap 'kill "$PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do curl -sf "http://localhost:$PORT/" >/dev/null && break; sleep 1; done
kill -0 "$PID" 2>/dev/null || { echo "這一台 preview 沒有活著（port 被搶走？），不驗"; exit 1; }
# 回應的是不是**我這台**？預查到 build 完之間別的工作樹可能搶到同一個 port：curl 拿到它的 200、
# 我的 npx 還在初始化也過得了 kill -0，隨後才因 --strictPort 退出，探針就去驗別人那台（Codex 第 37 輪 #2）。
# 監聽的 PID 必須是我起的那個程序或它的子孫。
LPID="$(lsof -t -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1)"
mine=0; p="$LPID"
while [ -n "$p" ] && [ "$p" != "1" ] && [ "$p" != "0" ]; do
  [ "$p" = "$PID" ] && { mine=1; break; }
  p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')"
done
[ "$mine" = "1" ] || { echo "port $PORT 上回應的不是這一台 preview（監聽 PID=$LPID，我的是 $PID），不驗"; exit 1; }
node scripts/ui-probe.mjs "http://localhost:$PORT/" || exit 1
echo "── 窄機 360px ──"
PROBE_NARROW=1 node scripts/ui-probe.mjs "http://localhost:$PORT/" || exit 1
# 探針跑完 preview 還得活著：中途死掉代表後面幾頁驗的可能是別人
kill -0 "$PID" 2>/dev/null || { echo "preview 在探針途中死了，結果不可信"; exit 1; }
