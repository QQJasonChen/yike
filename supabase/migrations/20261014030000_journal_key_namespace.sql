-- Candidate key-only guard. No payload, CAS, quota, RLS, or existing row is changed.
-- Calendar arithmetic is Gregorian, ASCII-only, independent of DateStyle/TimeZone.
-- week keys need not be Mondays: historical valid dated records remain accepted.
-- VALIDATE is in the same transaction: any incompatible old row aborts all DDL.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter table public.journal
  add constraint journal_key_namespace_known_data_v1
  check (
-- BEGIN KEY PREDICATE
    case
      when key in ('pp:settings','pp:life','pp:bizmodel','pp:pipAuto','pp:onboarded') then true
      when key ~ '^pp:(day|week):[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        substring(right(key,10),1,4)::integer between 1 and 9999
        and substring(right(key,10),6,2)::integer between 1 and 12
        and substring(right(key,10),9,2)::integer between 1 and
          case substring(right(key,10),6,2)::integer
            when 2 then case
              when substring(right(key,10),1,4)::integer % 400 = 0
                or (substring(right(key,10),1,4)::integer % 4 = 0
                    and substring(right(key,10),1,4)::integer % 100 <> 0)
              then 29 else 28 end
            when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30
            else 31
          end
      when key ~ '^pp:month:[0-9]{4}-[0-9]{2}$' then
        substring(right(key,7),1,4)::integer between 1 and 9999
        and substring(right(key,7),6,2)::integer between 1 and 12
      when key ~ '^pp:quarter:[0-9]{4}-Q[1-4]$' then
        substring(right(key,7),1,4)::integer between 1 and 9999
      when key ~ '^pp:year:[0-9]{4}$' then
        right(key,4)::integer between 1 and 9999
      else false
    end
-- END KEY PREDICATE
  ) not valid;

alter table public.journal validate constraint journal_key_namespace_known_data_v1;
commit;
