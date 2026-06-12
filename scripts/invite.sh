#!/bin/bash
# 一刻手帳：手動開通帳號（邀請制）
# 用法：./scripts/invite.sh customer@example.com 他們的初始密碼
# 服務金鑰讀自 ~/.yike-supabase-service-key（不在版控裡）
set -euo pipefail
EMAIL="${1:?用法: invite.sh <email> <password>}"
PASSWORD="${2:?用法: invite.sh <email> <password>}"
KEY=$(cat ~/.yike-supabase-service-key)
URL="https://ofhupqifavtafiylehkj.supabase.co"

curl -s -X POST "$URL/auth/v1/admin/users" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"email_confirm\":true}" \
  | python3 -c "
import json, sys
d = json.load(sys.stdin)
if d.get('id'):
    print(f'✓ 已開通 {d[\"email\"]}')
    print('  請把帳密交給對方，提醒登入後可自行沿用或要求換密碼')
else:
    print('✗ 失敗：', d.get('msg') or d.get('message') or d)
"
