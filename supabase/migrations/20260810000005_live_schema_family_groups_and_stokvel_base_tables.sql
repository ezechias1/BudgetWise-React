-- Base table definitions for tables that previously had zero migration
-- history in this repo (set up directly via Supabase dashboard). Must run
-- before 20260810000006, which adds FKs/policies against these tables.
--
-- Column names/types/defaults were pulled from information_schema against
-- the live production project. Cross-table FKs (the three stokvel_id
-- references below) were separately confirmed via a targeted
-- information_schema.referential_constraints query and use the exact
-- delete rule returned: ON DELETE CASCADE. auth.users(id) references
-- (owner_id/user_id/recipient_id) didn't surface in that query — Supabase
-- commonly restricts what the auth schema exposes to these system views —
-- but trips.user_id references auth.users(id) already applied cleanly
-- earlier in this same session, so that reference shape is treated as
-- established, not unconfirmed.
--
-- Written idempotently.

create table if not exists family_groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  family_code varchar(8) not null,
  family_name text,
  created_at timestamptz default now()
);

create table if not exists stokvel_groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id),
  name text not null,
  monthly_amount numeric not null default 0,
  frequency text not null default 'monthly',
  goal text default '',
  stokvel_code text,
  payout_order jsonb default '[]'::jsonb,
  current_payout_index integer default 0,
  created_at timestamptz default now(),
  start_date date,
  end_date date,
  bank_reference text default ''
);

create table if not exists stokvel_members (
  id uuid primary key default gen_random_uuid(),
  stokvel_id uuid references stokvel_groups(id) on delete cascade,
  user_id uuid references auth.users(id),
  display_name text not null,
  role text default 'member',
  approved boolean default false,
  joined_at timestamptz default now()
);

create table if not exists stokvel_contributions (
  id uuid primary key default gen_random_uuid(),
  stokvel_id uuid references stokvel_groups(id) on delete cascade,
  user_id uuid references auth.users(id),
  amount numeric not null,
  date date not null default current_date,
  note text default '',
  created_at timestamptz default now()
);

create table if not exists stokvel_payouts (
  id uuid primary key default gen_random_uuid(),
  stokvel_id uuid references stokvel_groups(id) on delete cascade,
  recipient_id uuid references auth.users(id),
  amount numeric not null,
  month text not null,
  paid boolean default false,
  created_at timestamptz default now()
);
