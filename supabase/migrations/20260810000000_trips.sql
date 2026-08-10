-- Trips feature — Expenses page, Personal/Family modes only.
--
-- All statements are idempotent (`if not exists` / `create or replace` /
-- `drop ... if exists` before `create`) because the base `expenses` table
-- (and possibly `trips` itself) may already have been created directly in
-- the live Supabase project rather than through a tracked migration —
-- matches the guard style used in 20260422000000_junior_phase1_schema.sql.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. trips
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  start_date date not null,
  end_date date not null,
  account_mode text not null check (account_mode in ('personal', 'family')),
  -- Reserved for future family-group sharing, same as expenses.group_id —
  -- not populated by the app today.
  group_id uuid,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create index if not exists trips_user_id_idx on trips (user_id);
create index if not exists trips_group_id_idx on trips (group_id);
create index if not exists trips_user_mode_dates_idx
  on trips (user_id, account_mode, start_date, end_date);

alter table trips enable row level security;

drop policy if exists "users manage own trips" on trips;
create policy "users manage own trips"
  on trips for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. expenses: trip_id + business_expense
-- ─────────────────────────────────────────────────────────────────────────
alter table expenses
  add column if not exists trip_id uuid references trips (id) on delete set null,
  add column if not exists business_expense boolean;

create index if not exists expenses_trip_id_idx on expenses (trip_id);

comment on column expenses.business_expense is
  'null = needs review; true/false only meaningful for expenses tagged to a trip.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Auto-tag trigger — matches new/updated personal/family expenses to a
--    trip by date range. Business-mode expenses are excluded entirely
--    (trips don't apply there) and always get trip_id cleared. An explicit
--    trip_id change made by the caller in the same statement (e.g. the
--    "remove from trip" action) is respected and not overridden.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function assign_expense_trip()
returns trigger as $$
declare
  matched_trip_id uuid;
begin
  if new.account_mode not in ('personal', 'family') then
    new.trip_id := null;
    return new;
  end if;

  if tg_op = 'UPDATE' and new.trip_id is distinct from old.trip_id then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.date = old.date
     and new.account_mode = old.account_mode
     and new.user_id = old.user_id then
    return new;
  end if;

  select id into matched_trip_id
  from trips
  where trips.user_id = new.user_id
    and trips.account_mode = new.account_mode
    and new.date between trips.start_date and trips.end_date
  order by trips.created_at desc
  limit 1;

  new.trip_id := matched_trip_id;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists assign_expense_trip_trigger on expenses;
create trigger assign_expense_trip_trigger
  before insert or update on expenses
  for each row execute function assign_expense_trip();
