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
node scripts/ui-probe.mjs "http://localhost:$PORT/" || exit 1
echo "── 窄機 360px ──"
PROBE_NARROW=1 node scripts/ui-probe.mjs "http://localhost:$PORT/"
