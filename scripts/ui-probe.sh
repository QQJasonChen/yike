#!/usr/bin/env bash
# 建置 → 起 preview → 跑 scripts/ui-probe.mjs → 一定關掉 preview（trap）
set -uo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-4180}"
npm run build >/tmp/ui-probe-build.log 2>&1 || { echo "build 失敗（/tmp/ui-probe-build.log）"; exit 1; }
npx vite preview --port "$PORT" >/dev/null 2>&1 &
PID=$!
trap 'kill "$PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do curl -sf "http://localhost:$PORT/" >/dev/null && break; sleep 1; done
node scripts/ui-probe.mjs "http://localhost:$PORT/"
