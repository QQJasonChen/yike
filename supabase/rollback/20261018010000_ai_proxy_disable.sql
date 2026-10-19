-- Review-only disable procedure for the installed, versioned AI proxy migration.
-- Execute only as the DB owner after separately disabling the Edge opt-in.
-- This file changes no ledgers, legacy RPC permissions/functions, or browser BYOK.
-- Repeat execution is safe: it only sets the existing singleton to disabled.
begin;
update public.ai_proxy_config set enabled=false where singleton=true;
commit;
