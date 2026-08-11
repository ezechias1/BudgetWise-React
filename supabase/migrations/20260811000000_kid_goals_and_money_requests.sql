-- BudgetWise Junior — kid-proposed goals + kid money requests.
--
-- family_goals/family_goal_contributions have no tracked base-table DDL in
-- this repo (created directly against Supabase pre-migration-adoption, same
-- situation the Stokvel tables were in) — this migration only ever ADDS
-- nullable/defaulted columns and new policies, never `create table`, so it
-- can't conflict with whatever the live definition actually is.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. family_goals: per-kid goals, proposed by a kid and approved by a parent
-- ─────────────────────────────────────────────────────────────────────────
-- member_id null = today's existing family-wide goals (untouched, still
-- shown to every kid). member_id set = a goal that belongs to one kid.
alter table family_goals
  add column if not exists member_id uuid references family_members(id),
  add column if not exists status text not null default 'active'
    check (status in ('pending', 'active', 'declined'));

comment on column family_goals.member_id is
  'Null = family-wide goal (legacy). Set = belongs to one kid, who proposed it.';
comment on column family_goals.status is
  'pending = kid-proposed, awaiting parent approval. active = real, counts toward saved. declined = parent said no.';

-- Kid can propose a goal for themselves — member_id and user_id must both
-- come from the same family_members row as the calling kid's own session,
-- and it must land as pending (never self-approve).
drop policy if exists "kid proposes own goal" on family_goals;
create policy "kid proposes own goal"
  on family_goals for insert to authenticated
  with check (
    status = 'pending'
    and exists (
      select 1 from family_members
      where family_members.auth_user_id = auth.uid()
        and family_members.id = family_goals.member_id
        and family_members.user_id = family_goals.user_id
    )
  );

-- Additive to the existing "child reads parent family_goals" policy
-- (family-wide goals) — a kid also sees their own per-kid goals, pending or
-- active, in addition to the shared family ones.
drop policy if exists "kid reads own family_goals" on family_goals;
create policy "kid reads own family_goals"
  on family_goals for select to authenticated
  using (
    member_id in (select id from family_members where auth_user_id = auth.uid())
  );

-- Explicit, narrowly-scoped policy for approving/declining a kid's
-- proposal, in case the existing (untracked) parent-owns-goal policy is
-- scoped more narrowly than a plain ownership check.
drop policy if exists "parent manages own family_goals" on family_goals;
create policy "parent manages own family_goals"
  on family_goals for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Kid can update their own goal (needed for "Add money" bumping `saved`
-- directly, same non-atomic pattern the parent's own contribute() already
-- uses). Restricted to rows that are — and remain — 'active': a kid can't
-- use this path to self-approve a pending proposal or un-approve one,
-- since that would defeat the whole point of requiring parent sign-off.
drop policy if exists "kid funds own goal" on family_goals;
create policy "kid funds own goal"
  on family_goals for update to authenticated
  using (
    member_id in (select id from family_members where auth_user_id = auth.uid())
    and status = 'active'
  )
  with check (
    member_id in (select id from family_members where auth_user_id = auth.uid())
    and status = 'active'
  );

-- Kid can fund their own goal (existing contribute() flow already does
-- this for parents; family_goal_contributions already has a member_id
-- column per FamilyGoalsPage.tsx's existing usage).
drop policy if exists "kid inserts own goal contribution" on family_goal_contributions;
create policy "kid inserts own goal contribution"
  on family_goal_contributions for insert to authenticated
  with check (
    member_id in (select id from family_members where auth_user_id = auth.uid())
  );

drop policy if exists "kid reads own goal contributions" on family_goal_contributions;
create policy "kid reads own goal contributions"
  on family_goal_contributions for select to authenticated
  using (
    member_id in (select id from family_members where auth_user_id = auth.uid())
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 2. kid_money_requests — kid asks a parent for a specific amount, single
--    round (approve as-is / approve a different amount / decline).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists kid_money_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),   -- parent, for RLS scoping
  member_id uuid not null references family_members(id),
  goal_id uuid references family_goals(id),           -- optional
  requested_amount_cents integer not null check (requested_amount_cents > 0),
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  approved_amount_cents integer,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index if not exists kid_money_requests_user_id_idx on kid_money_requests (user_id);
create index if not exists kid_money_requests_member_id_idx on kid_money_requests (member_id);

alter table kid_money_requests enable row level security;

drop policy if exists "kid inserts own money request" on kid_money_requests;
create policy "kid inserts own money request"
  on kid_money_requests for insert to authenticated
  with check (
    status = 'pending'
    and exists (
      select 1 from family_members
      where family_members.auth_user_id = auth.uid()
        and family_members.id = kid_money_requests.member_id
        and family_members.user_id = kid_money_requests.user_id
    )
  );

drop policy if exists "kid reads own money requests" on kid_money_requests;
create policy "kid reads own money requests"
  on kid_money_requests for select to authenticated
  using (
    member_id in (select id from family_members where auth_user_id = auth.uid())
  );

drop policy if exists "parent manages own money requests" on kid_money_requests;
create policy "parent manages own money requests"
  on kid_money_requests for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
