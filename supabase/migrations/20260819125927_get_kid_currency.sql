-- A child's session can only read its own family_members row; user_settings is
-- `auth.uid() = user_id`, which is the PARENT. So the Junior screens had no way
-- to learn the family's currency and every amount was hardcoded to Rand.
--
-- Returns the currency code and nothing else — the narrowest thing that answers
-- the question, rather than exposing the parent's settings row to a child.
create or replace function public.get_kid_currency()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(nullif(s.fam_currency, ''), nullif(s.currency, ''), 'ZAR')
  from public.family_members m
  join public.user_settings s on s.user_id = m.user_id
  where m.auth_user_id = auth.uid()
  limit 1;
$$;

revoke all on function public.get_kid_currency() from public;
revoke all on function public.get_kid_currency() from anon;
grant execute on function public.get_kid_currency() to authenticated;
