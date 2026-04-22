-- BudgetWise Junior — Phase 1 schema
-- Adds child-account fields to family_members, audit cols to family_chores,
-- and creates kid_ledger / kid_missions / kid_mission_progress /
-- kid_mission_rewards / kid_streaks / kid_notifications / kid_devices.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. family_members: add child-login + age + jar split
-- ─────────────────────────────────────────────────────────────────────────
alter table family_members
  add column if not exists auth_user_id uuid references auth.users (id) on delete set null,
  add column if not exists pin_hash text,
  add column if not exists date_of_birth date,
  add column if not exists jar_split jsonb not null default '{"save":50,"spend":30,"give":20}'::jsonb;

create unique index if not exists family_members_auth_user_id_idx
  on family_members (auth_user_id)
  where auth_user_id is not null;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. family_chores: approval audit trail
-- ─────────────────────────────────────────────────────────────────────────
alter table family_chores
  add column if not exists approved_at timestamptz,
  add column if not exists rejected_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. kid_ledger — the IOU source of truth
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists kid_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  member_id uuid not null references family_members (id) on delete cascade,
  amount_cents integer not null check (amount_cents >= 0),
  source_type text not null check (source_type in ('chore','lesson','allowance','adjustment')),
  source_id uuid,
  status text not null default 'owed' check (status in ('owed','paid','void')),
  split jsonb,
  notes text,
  earned_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists kid_ledger_member_id_idx on kid_ledger (member_id);
create index if not exists kid_ledger_user_id_idx on kid_ledger (user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. kid_missions — seeded static content (editable via seed script only)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists kid_missions (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  unit text not null,
  title text not null,
  age_min integer not null default 10,
  age_max integer not null default 13,
  body jsonb not null,
  ord integer not null default 0,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 5. kid_mission_progress — per-kid state
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists kid_mission_progress (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references family_members (id) on delete cascade,
  mission_id uuid not null references kid_missions (id) on delete cascade,
  status text not null default 'available' check (status in ('locked','available','completed')),
  completed_at timestamptz,
  quiz_score integer,
  reward_amount_cents integer,
  unique (member_id, mission_id)
);

-- ─────────────────────────────────────────────────────────────────────────
-- 6. kid_mission_rewards — parent-configured reward per mission
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists kid_mission_rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mission_id uuid not null references kid_missions (id) on delete cascade,
  reward_amount_cents integer not null default 0,
  unique (user_id, mission_id)
);

-- ─────────────────────────────────────────────────────────────────────────
-- 7. kid_streaks — daily streak per member
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists kid_streaks (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null unique references family_members (id) on delete cascade,
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  last_active_date date
);

-- ─────────────────────────────────────────────────────────────────────────
-- 8. kid_notifications — outgoing notification queue
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists kid_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('approval_nudge','daily_digest','sunday_reminder')),
  payload jsonb not null default '{}'::jsonb,
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  status text not null default 'pending' check (status in ('pending','sent','cancelled'))
);

-- ─────────────────────────────────────────────────────────────────────────
-- 9. kid_devices — multi-kid-per-device lock screen support
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists kid_devices (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  member_id uuid not null references family_members (id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  unique (device_id, member_id)
);

-- ─────────────────────────────────────────────────────────────────────────
-- 10. Row-Level Security
-- ─────────────────────────────────────────────────────────────────────────
alter table kid_ledger enable row level security;
alter table kid_missions enable row level security;
alter table kid_mission_progress enable row level security;
alter table kid_mission_rewards enable row level security;
alter table kid_streaks enable row level security;
alter table kid_notifications enable row level security;
alter table kid_devices enable row level security;

-- kid_missions is public read-only content for any authenticated user
create policy "authenticated can read missions"
  on kid_missions for select to authenticated using (true);

-- kid_ledger: parent can read/write own rows; child can read rows scoped to their member row
create policy "parent manages own ledger"
  on kid_ledger for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "child reads own ledger"
  on kid_ledger for select to authenticated
  using (
    member_id in (
      select id from family_members where auth_user_id = auth.uid()
    )
  );

-- kid_mission_progress: parent manages all their children; child manages own
create policy "parent manages own children progress"
  on kid_mission_progress for all to authenticated
  using (
    member_id in (
      select id from family_members where user_id = auth.uid()
    )
  )
  with check (
    member_id in (
      select id from family_members where user_id = auth.uid()
    )
  );

create policy "child manages own progress"
  on kid_mission_progress for all to authenticated
  using (
    member_id in (
      select id from family_members where auth_user_id = auth.uid()
    )
  )
  with check (
    member_id in (
      select id from family_members where auth_user_id = auth.uid()
    )
  );

-- kid_mission_rewards: parent-only (child never writes reward amounts)
create policy "parent manages rewards"
  on kid_mission_rewards for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "child reads rewards for their parent"
  on kid_mission_rewards for select to authenticated
  using (
    user_id in (
      select user_id from family_members where auth_user_id = auth.uid()
    )
  );

-- kid_streaks: child reads/writes own; parent reads children's
create policy "child manages own streak"
  on kid_streaks for all to authenticated
  using (
    member_id in (
      select id from family_members where auth_user_id = auth.uid()
    )
  )
  with check (
    member_id in (
      select id from family_members where auth_user_id = auth.uid()
    )
  );

create policy "parent reads children streaks"
  on kid_streaks for select to authenticated
  using (
    member_id in (
      select id from family_members where user_id = auth.uid()
    )
  );

-- kid_notifications: parent-only
create policy "parent manages own notifications"
  on kid_notifications for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- kid_devices: parent manages for their children; child can upsert own row
create policy "parent manages devices for children"
  on kid_devices for all to authenticated
  using (
    member_id in (
      select id from family_members where user_id = auth.uid()
    )
  )
  with check (
    member_id in (
      select id from family_members where user_id = auth.uid()
    )
  );

create policy "child upserts own device row"
  on kid_devices for all to authenticated
  using (
    member_id in (
      select id from family_members where auth_user_id = auth.uid()
    )
  )
  with check (
    member_id in (
      select id from family_members where auth_user_id = auth.uid()
    )
  );

-- family_members: child can read their own row (needed for useKidProfile hook)
-- Parent policies on family_members already exist from prior migrations; this is additive.
drop policy if exists "child reads own member row" on family_members;
create policy "child reads own member row"
  on family_members for select to authenticated
  using (auth_user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────
-- 11. Seed one mission so Phase 2 has something to point at
-- ─────────────────────────────────────────────────────────────────────────
insert into kid_missions (slug, unit, title, ord, body) values (
  'what-is-saving',
  'Saving',
  'What does it mean to save?',
  1,
  '{
    "steps": [
      {"type":"hook","title":"Zoë''s R100","body":"Zoë got R100 from her gran. Watch what happens when she spends it all on sweets vs splits it into jars."},
      {"type":"concept","title":"A jar that waits grows","body":"A jar that waits grows. A jar that rushes empties."},
      {"type":"quiz","question":"Which jar gets bigger over time?","options":["The Save jar","The Spend jar","The Give jar"],"answer":0},
      {"type":"tie_in","body":"If you saved half of what you earn this week, your goal would be closer."},
      {"type":"done","body":"Mission done! Your first lesson is complete."}
    ]
  }'::jsonb
) on conflict (slug) do nothing;
