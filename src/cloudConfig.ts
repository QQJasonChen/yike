// 雲端同步設定（Supabase）
// anon key 是公開金鑰（資料安全由 Row Level Security 保證），可以放進版控。
export const SUPABASE_URL = 'https://ofhupqifavtafiylehkj.supabase.co'
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9maHVwcWlmYXZ0YWZpeWxlaGtqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNDk4MTIsImV4cCI6MjA5NjgyNTgxMn0.9sgHMRQ2BkhaB3m-rP7tCau4G2aGAvxsJAId31dJFL4'

export const cloudEnabled = (): boolean => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)
