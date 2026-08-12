-- ============================================================
-- Shared family ledger.
--
-- Every approved member of a family group sees the same Family-mode
-- expenses, colour-coded per person — so when one partner spends, it
-- shows up for both.
--
-- Scoped via the denormalised expenses.group_id (which already has an FK
-- to family_groups with ON DELETE SET NULL) rather than a live join
-- through family_links on every read. Matches how trip_id already works,
-- set at write time, and keeps the policy cheap on the app's
-- highest-traffic table.
--
-- ⚠️ Family mode ONLY. Personal and Business expenses stay private to
-- their owner — that separation is the entire point of modes, and a
-- policy that leaked across it would be a serious regression.
-- ============================================================

-- Colour per linked member, for per-person colour coding in the shared
-- ledger. Deliberately separate from family_members.color: that column
-- belongs to the in-account profile system (Members / Allowances), while
-- family_links is the cross-account system where each row is a real
-- separate login.
alter table family_links
  add column if not exists color text;

-- Backfill a stable default so existing members are distinguishable
-- immediately rather than all rendering in one colour. Deterministic on
-- id, so it doesn't shuffle between runs.
update family_links
set color = (array[
  '#8b5cf6', '#10b981', '#f59e0b', '#ef4444',
  '#3b82f6', '#ec4899', '#14b8a6', '#f97316'
])[1 + (('x' || substr(md5(id::text), 1, 8))::bit(32)::bigint % 8)]
where color is null;

-- ------------------------------------------------------------
-- Backfill group_id on existing Family-mode expenses.
--
-- Safe as a single-group-per-user update: verified that no user belongs
-- to more than one approved family group, so the join below cannot be
-- nondeterministic. If that ever stops holding, this needs a rule for
-- which group an expense belongs to BEFORE it can be re-run.
--
-- Only touches account_mode = 'family' rows with a null group_id, so
-- Personal/Business rows and the 2 pre-existing test rows are untouched.
-- ------------------------------------------------------------
update expenses e
set group_id = fl.group_id
from family_links fl
where fl.user_id = e.user_id
  and fl.approved is true
  and e.account_mode = 'family'
  and e.group_id is null;

-- ------------------------------------------------------------
-- Read policy.
--
-- Wrapped in a STABLE SECURITY DEFINER function rather than a raw
-- subquery in the policy: it keeps the planner from re-running the
-- membership lookup per row, and stops the policy on expenses from
-- re-triggering policy evaluation on family_links (which would recurse).
-- Same pattern as is_stokvel_member / is_approved_family_member.
-- ------------------------------------------------------------
create or replace function can_read_family_expense(gid uuid, amode text)
returns boolean
language sql stable security definer set search_path = 'public'
as $$
  select
    amode = 'family'
    and gid is not null
    and exists (
      select 1 from family_links
      where group_id = gid
        and user_id = auth.uid()
        and approved is true
    )
$$;

revoke all on function can_read_family_expense(uuid, text) from public, anon;
grant execute on function can_read_family_expense(uuid, text) to authenticated;

-- Additive only: this sits alongside the existing owner policy, so a user
-- keeps full access to their own rows in every mode and gains read access
-- to group-mates' Family-mode rows. Writes are untouched — nobody can
-- edit or delete a partner's expense.
drop policy if exists "expenses_select_family_group" on expenses;
create policy "expenses_select_family_group"
  on expenses for select
  using (can_read_family_expense(group_id, account_mode));

-- Partial index matching the policy's access pattern.
create index if not exists expenses_family_group_idx
  on expenses (group_id)
  where account_mode = 'family';

-- ------------------------------------------------------------
-- Roster RPC — who is in my family group, and what colour are they?
--
-- Needed because we can't assume the client can read other members'
-- family_links rows directly (get_family_income exists for the same
-- reason). Without this the shared ledger has no source for the colour
-- coding or for turning a row's user_id into a name.
-- ------------------------------------------------------------
create or replace function get_family_members(p_group_id uuid)
returns table (user_id uuid, display_name text, color text)
language sql stable security definer set search_path = 'public'
as $$
  select fl.user_id, fl.display_name, fl.color
  from family_links fl
  where fl.group_id = p_group_id
    and fl.approved is true
    and is_approved_family_member(p_group_id)
$$;

revoke all on function get_family_members(uuid) from public, anon;
grant execute on function get_family_members(uuid) to authenticated;

-- ------------------------------------------------------------
-- Write guard. REQUIRED for the read policy above to be safe.
--
-- The existing UPDATE policy ("Users can update own expenses") has
-- `using (user_id = auth.uid())` but no WITH CHECK, so a user can set
-- their own row's group_id and account_mode to anything. That was
-- harmless while nothing read group_id cross-user — the read policy
-- above is what makes it exploitable: set account_mode = 'family' and
-- group_id = <another family's group>, and the row appears in that
-- household's shared ledger.
--
-- group_id is not a secret. It is returned to every legitimate member's
-- client in normal responses, so "they'd have to guess the UUID" is not
-- a control.
--
-- These are RESTRICTIVE, not permissive, and that distinction is the
-- whole point: Postgres ORs permissive policies together, so adding a
-- permissive policy here would WIDEN access and close nothing.
-- Restrictive policies AND with the existing ones, which is what
-- actually constrains the write — and it means we don't have to
-- enumerate and replace every existing policy to be sure.
--
-- Scoped to INSERT/UPDATE only, deliberately not FOR ALL: a restrictive
-- USING clause would also apply to SELECT, which would stop a user
-- reading their own pre-existing rows that carry a group_id they are no
-- longer a member of (the 2 leftover "The Testers" rows are exactly
-- that shape).
-- ------------------------------------------------------------
drop policy if exists "expenses_group_write_guard_insert" on expenses;
create policy "expenses_group_write_guard_insert"
  on expenses as restrictive for insert
  with check (group_id is null or is_approved_family_member(group_id));

drop policy if exists "expenses_group_write_guard_update" on expenses;
create policy "expenses_group_write_guard_update"
  on expenses as restrictive for update
  using (true)
  with check (group_id is null or is_approved_family_member(group_id));

-- NOTE for the frontend: the group-scoped read must still preserve the
-- existing `.or('trip_id.is.null,business_expense.eq.false')` and
-- `review_status = 'confirmed'` filters from useExpenses.ts. RLS widens
-- WHICH ROWS are visible; it does not enforce which ones belong in the
-- ledger view. Dropping those filters here would put unreviewed trip
-- expenses and pending imports back into household totals.
