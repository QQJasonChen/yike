-- Fix the mutable-search-path advisor warning without changing CAS behavior.
-- Application roles need row CRUD, not table administration privileges.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter function public.journal_set_updated_at() set search_path=pg_catalog,public,pg_temp;
revoke truncate,references,trigger on public.journal from public,anon,authenticated,service_role;
commit;
