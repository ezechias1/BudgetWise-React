-- Correcting an anomaly the previous version of this function introduced.
--
-- It preferred fam_currency over currency. But nothing in the app ever WRITES
-- fam_currency or biz_currency — useUserSettings.updateSettings always writes
-- plain `currency` whatever the mode, and no settings screen offers a per-mode
-- currency. They are vestigial columns; an account has exactly one currency.
--
-- So the preference invented a distinction the product does not have, and it
-- had a cost: ChoresPage had to match this coalesce to agree with the child's
-- screen, which then put it out of step with the four sibling parent screens
-- that read plain `currency` (Allowances, Members, Family Goals, the Junior
-- dashboard). The chore delete confirm quotes a total and points the parent at
-- the settle-up screen — two screens named in one sentence that could disagree.
--
-- Reading the same column everything else reads removes the mismatch instead
-- of spreading it. If a real per-mode currency is ever wanted, it needs a
-- writer and a settings UI first, and this can follow it then.
create or replace function public.get_kid_currency()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(nullif(s.currency, ''), 'ZAR')
  from public.family_members m
  join public.user_settings s on s.user_id = m.user_id
  where m.auth_user_id = auth.uid()
  limit 1;
$$;

revoke all on function public.get_kid_currency() from public;
revoke all on function public.get_kid_currency() from anon;
grant execute on function public.get_kid_currency() to authenticated;
