-- Additive activation repair. Existing ledger columns/functions/policies stay intact.
-- The trusted activate backend verifies Gumroad and proves Auth ownership first;
-- this service-role-only RPC independently pins that UID/email for the transaction.
begin;

create function public.license_activate_grant(
  p_license_key text,
  p_email text,
  p_user_id uuid,
  p_seed_uses integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  k text := lower(p_license_key);
  mail text := lower(p_email);
  inserted boolean := false;
  pre integer;
  n bigint;
begin
  -- No parameter or purchase credentials are included in error text.
  if k is null or octet_length(k) = 0 or octet_length(k) > 4096
     or k <> btrim(k) or k ~ '[[:cntrl:]]'
     or mail is null or octet_length(mail) = 0 or octet_length(mail) > 320
     or mail <> btrim(mail) or mail ~ '[[:cntrl:]]'
     or p_seed_uses is null or p_seed_uses < 0 then
    raise exception 'Invalid activation arguments' using errcode = '22023';
  end if;
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'new_redemption', false, 'reason', 'owner-mismatch');
  end if;

  -- Exactly the existing four-argument license_redeem lock namespace.
  perform pg_advisory_xact_lock(hashtext('lic:' || k));
  -- FOR SHARE also blocks non-key email updates and deletion until commit.
  -- Never inspect password hashes, sessions, or a caller-supplied email alone.
  perform u.id from auth.users u
    where u.id = p_user_id and lower(u.email) = mail
    for share;
  if not found then
    return jsonb_build_object('ok', false, 'new_redemption', false, 'reason', 'owner-mismatch');
  end if;

  if not exists (select 1 from public.license_redemptions r
                 where r.license_key = k and r.email = mail) then
    -- Preserve the old min(seed) contract: NULL rows do not lower a known seed.
    select min(r.seed_at_insert) into pre
      from public.license_redemptions r where r.license_key = k;
    pre := coalesce(pre, p_seed_uses);
    if pre < 0 then
      raise exception 'Invalid historical activation seed' using errcode = '23514';
    end if;
    insert into public.license_redemptions(license_key, email, seed_at_insert)
      values (k, mail, pre)
      on conflict (license_key, email) do nothing
      returning true into inserted;
    inserted := coalesce(inserted, false);
    if inserted then
      select count(*) into n from public.license_redemptions r where r.license_key = k;
      -- A legal INT_MAX seed plus a row must reject rather than overflow.
      if pre::bigint + n > 3::bigint then
        delete from public.license_redemptions r where r.license_key = k and r.email = mail;
        return jsonb_build_object('ok', false, 'new_redemption', false, 'reason', 'cap-reached');
      end if;
    end if;
  end if;

  -- Same key/email retries repair a missing entitlement even at a full cap.
  -- Preserve an existing IAP/Portaly/manual receipt and its timestamps exactly.
  insert into public.entitlements(email, source, raw, redeemed_at)
    values (mail, 'gumroad', jsonb_build_object(
      'verification', 'server-verified-gumroad',
      'seed_uses', p_seed_uses,
      'activation_rpc_version', 1
    ), now())
    on conflict (email) do nothing;
  -- Any entitlement/ledger error propagates and rolls back the whole RPC.
  return jsonb_build_object('ok', true, 'new_redemption', inserted);
end;
$$;

alter function public.license_activate_grant(text, text, uuid, integer) owner to postgres;
revoke execute on function public.license_activate_grant(text, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.license_activate_grant(text, text, uuid, integer) to service_role;

commit;
