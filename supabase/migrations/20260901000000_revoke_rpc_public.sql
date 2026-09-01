-- 收回計數器 RPC 的公開執行權。
--
-- 為什麼：Postgres 建立函式後，PUBLIC 預設就有 EXECUTE。這兩支是 SECURITY DEFINER，
-- 所以任何人拿公開的 anon key（本來就在前端 bundle 裡，設計如此）就能繞過 RLS 直接呼叫：
--   * rate_limit_bump('act:email:某人', ...) 打 20 次 → 把那個人鎖在開通流程外一小時。
--     針對每個新買家做一次，等於直接掐斷收錢路徑。
--   * ai_usage_bump(任意 uid) → 耗光別人的每日 AI 額度。
--   * 灌大量隨機 bucket → 計數表無上限成長。
--
-- 只有 edge function 需要呼叫它們，而 edge function 用的是 service_role。
-- 2026-09-01 由 Codex 靜態分析指出、實測確認（anon 呼叫兩支都回 true）。
revoke execute on function public.ai_usage_bump(uuid, int) from public, anon, authenticated;
revoke execute on function public.rate_limit_bump(text, int, int) from public, anon, authenticated;
grant execute on function public.ai_usage_bump(uuid, int) to service_role;
grant execute on function public.rate_limit_bump(text, int, int) to service_role;
