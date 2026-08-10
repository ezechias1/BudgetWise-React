-- ============================================================
-- This migration documents schema that was already applied directly
-- against the live production Supabase project (trkdlwukjyupvvcyzebf)
-- in a separate Claude session, without a corresponding migration file
-- ever being committed here. It replaces 5 migration files drafted in
-- *this* repo's session (20260810000000 through 20260810000004) that
-- assumed different column/trigger names and were never actually run —
-- those have been deleted since they duplicate and conflict with what's
-- really live (e.g. this repo had assumed `is_business_card`, but the
-- real column is `is_business`; this repo had assumed a trigger named
-- `assign_expense_trip_trigger`, but the real one is `expenses_auto_tag_trip`).
--
-- Every statement below is idempotent, so it's safe to run against any
-- environment (including production, where it's a no-op) to bring a
-- fresh dev/staging database in line with what's actually live.
--
-- Depends on 20260810000005, which creates family_groups and the four
-- stokvel_* base tables referenced here (trips.group_id's FK and every
-- policy/function below need those to already exist).
-- ============================================================

-- ─────────────────────────────────────────────────────────────────────────
-- Trips table
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  name text not null,
  start_date text not null,
  end_date text not null,
  account_mode text not null default 'personal' check (account_mode in ('personal', 'family')),
  group_id uuid references family_groups(id),
  created_at timestamptz not null default now(),
  constraint trips_date_order check (end_date >= start_date)
);

alter table trips enable row level security;

drop policy if exists "users manage own trips" on trips;
create policy "users manage own trips"
  on trips for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists trips_user_daterange_idx on trips (user_id, start_date, end_date);

-- ─────────────────────────────────────────────────────────────────────────
-- Expenses: trip tagging columns
-- ─────────────────────────────────────────────────────────────────────────
alter table expenses
  add column if not exists trip_id uuid references trips(id) on delete set null,
  add column if not exists business_expense boolean;
-- business_expense: null = needs review, true = business, false = personal

create index if not exists expenses_trip_id_idx on expenses (trip_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Linked accounts: business-card flag
-- ─────────────────────────────────────────────────────────────────────────
alter table linked_accounts
  add column if not exists is_business boolean not null default false;
-- NOTE: column name is "is_business", NOT "is_business_card"

-- ─────────────────────────────────────────────────────────────────────────
-- Auto-tagging trigger: sets trip_id on insert/update based on date range,
-- for personal/family expenses only. Does NOT touch business_expense.
-- Does NOT ever discard/cancel a row -- always returns new.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function auto_tag_trip()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.trip_id is null and new.account_mode in ('personal', 'family') then
    select id into new.trip_id
    from trips
    where trips.user_id = new.user_id
      and new.date between trips.start_date and trips.end_date
      and trips.account_mode = new.account_mode
    order by trips.created_at desc
    limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists expenses_auto_tag_trip on expenses;
create trigger expenses_auto_tag_trip
  before insert or update of date, account_mode on expenses
  for each row
  execute function auto_tag_trip();

-- ============================================================
-- Stokvel RLS fix (separate issue, same session -- these 4 tables
-- previously had a single "auth.uid() IS NOT NULL" policy each,
-- meaning any logged-in user could read/write any other user's
-- stokvel data). Replaced with proper ownership/membership scoping.
-- ============================================================

create or replace function is_stokvel_owner(sid uuid)
returns boolean
language sql stable security definer set search_path = 'public'
as $$
  select exists (select 1 from stokvel_groups where id = sid and owner_id = auth.uid())
$$;

create or replace function is_stokvel_member(sid uuid)
returns boolean
language sql stable security definer set search_path = 'public'
as $$
  select exists (select 1 from stokvel_members where stokvel_id = sid and user_id = auth.uid())
$$;

-- stokvel_groups
drop policy if exists "stokvel_groups_all" on stokvel_groups;
drop policy if exists "stokvel_groups_select" on stokvel_groups;
drop policy if exists "stokvel_groups_insert" on stokvel_groups;
drop policy if exists "stokvel_groups_update" on stokvel_groups;
drop policy if exists "stokvel_groups_delete" on stokvel_groups;

create policy "stokvel_groups_select" on stokvel_groups for select to authenticated
  using (owner_id = auth.uid() or is_stokvel_member(id));
create policy "stokvel_groups_insert" on stokvel_groups for insert to authenticated
  with check (owner_id = auth.uid());
create policy "stokvel_groups_update" on stokvel_groups for update to authenticated
  using (owner_id = auth.uid());
create policy "stokvel_groups_delete" on stokvel_groups for delete to authenticated
  using (owner_id = auth.uid());

-- stokvel_members
drop policy if exists "stokvel_members_all" on stokvel_members;
drop policy if exists "stokvel_members_select" on stokvel_members;
drop policy if exists "stokvel_members_insert" on stokvel_members;
drop policy if exists "stokvel_members_update" on stokvel_members;
drop policy if exists "stokvel_members_delete" on stokvel_members;

create policy "stokvel_members_select" on stokvel_members for select to authenticated
  using (user_id = auth.uid() or is_stokvel_owner(stokvel_id) or is_stokvel_member(stokvel_id));
create policy "stokvel_members_insert" on stokvel_members for insert to authenticated
  with check (user_id = auth.uid() or is_stokvel_owner(stokvel_id));
create policy "stokvel_members_update" on stokvel_members for update to authenticated
  using (is_stokvel_owner(stokvel_id));
create policy "stokvel_members_delete" on stokvel_members for delete to authenticated
  using (is_stokvel_owner(stokvel_id) or user_id = auth.uid());

-- stokvel_contributions
drop policy if exists "stokvel_contribs_all" on stokvel_contributions;
drop policy if exists "stokvel_contribs_select" on stokvel_contributions;
drop policy if exists "stokvel_contribs_insert" on stokvel_contributions;
drop policy if exists "stokvel_contribs_update" on stokvel_contributions;
drop policy if exists "stokvel_contribs_delete" on stokvel_contributions;

create policy "stokvel_contribs_select" on stokvel_contributions for select to authenticated
  using (is_stokvel_owner(stokvel_id) or is_stokvel_member(stokvel_id));
create policy "stokvel_contribs_insert" on stokvel_contributions for insert to authenticated
  with check (user_id = auth.uid() or is_stokvel_owner(stokvel_id));
create policy "stokvel_contribs_update" on stokvel_contributions for update to authenticated
  using (user_id = auth.uid() or is_stokvel_owner(stokvel_id));
create policy "stokvel_contribs_delete" on stokvel_contributions for delete to authenticated
  using (user_id = auth.uid() or is_stokvel_owner(stokvel_id));

-- stokvel_payouts
drop policy if exists "stokvel_payouts_all" on stokvel_payouts;
drop policy if exists "stokvel_payouts_select" on stokvel_payouts;
drop policy if exists "stokvel_payouts_insert" on stokvel_payouts;
drop policy if exists "stokvel_payouts_update" on stokvel_payouts;
drop policy if exists "stokvel_payouts_delete" on stokvel_payouts;

create policy "stokvel_payouts_select" on stokvel_payouts for select to authenticated
  using (is_stokvel_owner(stokvel_id) or is_stokvel_member(stokvel_id));
create policy "stokvel_payouts_insert" on stokvel_payouts for insert to authenticated
  with check (is_stokvel_owner(stokvel_id));
create policy "stokvel_payouts_update" on stokvel_payouts for update to authenticated
  using (is_stokvel_owner(stokvel_id));
create policy "stokvel_payouts_delete" on stokvel_payouts for delete to authenticated
  using (is_stokvel_owner(stokvel_id));

-- ============================================================
-- Locked down two functions that were callable by unauthenticated
-- (anon) requests unnecessarily. Both already gated correctly
-- internally (returned empty/false for anon), but shouldn't be
-- publicly invokable at all as defense-in-depth.
-- ============================================================
revoke execute on function get_admin_users() from public;
grant execute on function get_admin_users() to authenticated;

revoke execute on function can_insert_expense_for(uuid) from public;
grant execute on function can_insert_expense_for(uuid) to authenticated;
