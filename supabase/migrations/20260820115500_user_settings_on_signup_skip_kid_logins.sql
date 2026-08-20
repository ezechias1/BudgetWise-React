-- The signup trigger fired for Junior PIN logins too, because create-kid-user
-- makes a real auth.users row for each child. Found by watching a live kid
-- signup: the child's login came back with a user_settings row attached.
--
-- A child never opens the dashboard those settings drive, and rows created this
-- way were what previously blocked deleting a kid (before the FK was changed to
-- cascade). They were deleted once by hand; without this the trigger simply
-- recreates one for every new child.
--
-- Kid logins are identifiable by the address create-kid-user mints for them:
-- kid-<member uuid>@budgetwise.app. Matching on that is narrow and, if it ever
-- stops matching, the failure is a spare settings row rather than a broken
-- signup.
create or replace function public.handle_new_user_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is not null and new.email like 'kid-%@budgetwise.app' then
    return new;
  end if;

  insert into public.user_settings (user_id, currency, income, savings_goal, account_mode)
  values (new.id, 'ZAR', 0, 0, 'personal')
  on conflict (user_id) do nothing;
  return new;
exception when others then
  -- Never block a signup over this. See the original migration.
  return new;
end;
$$;

delete from public.user_settings s
where exists (
  select 1 from auth.users u
  where u.id = s.user_id and u.email like 'kid-%@budgetwise.app'
);
