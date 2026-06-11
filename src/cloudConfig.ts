// 雲端同步設定（Supabase）
// 建好 Supabase 專案後，把 Project URL 和 anon public key 填進來即可啟用帳號同步。
// anon key 本來就是公開金鑰（資料安全由 Row Level Security 保證），可以放心進版控。
export const SUPABASE_URL = ''
export const SUPABASE_ANON_KEY = ''

export const cloudEnabled = (): boolean => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)
