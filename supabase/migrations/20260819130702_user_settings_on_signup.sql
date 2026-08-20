-- Roughly 11 of 27 existing accounts had no user_settings row, because nothing
-- ever created one — it only appeared the first time the user happened to save
-- something that upserted. Every `.update()` against user_settings was therefore
-- a silent no-op for those accounts: budget limits, the tithe toggle and the
-- automations switches all reported success and saved nothing.
--
-- The row now exists from the moment the account does.
--
-- The exception handler is the important part. This runs inside the signup
-- transaction, so an error here would fail the signup itself — the front door of
-- the app. Nothing about a missing settings row is worth refusing an account
-- over: the client upserts anyway, so the worst case of swallowing the error is
-- the status quo, and the worst case of not swallowing it is that nobody can
-- sign up at all.
create or replace function public.handle_new_user_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_settings (user_id, currency, income, savings_goal, account_mode)
  values (new.id, 'ZAR', 0, 0, 'personal')
  on conflict (user_id) do nothing;
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_settings on auth.users;
create trigger on_auth_user_created_settings
after insert on auth.users
for each row execute function public.handle_new_user_settings();

-- Backfill the accounts that predate the trigger.
insert into public.user_settings (user_id, currency, income, savings_goal, account_mode)
select u.id, 'ZAR', 0, 0, 'personal'
from auth.users u
left join public.user_settings s on s.user_id = u.id
where s.user_id is null
on conflict (user_id) do nothing;

-- ...but NOT for the PIN logins that belong to children. A child never opens
-- the dashboard those settings drive, and the row is what made deleting a kid
-- fail against the NO ACTION FK below.
delete from public.user_settings s
where exists (select 1 from public.family_members m where m.auth_user_id = s.user_id);
