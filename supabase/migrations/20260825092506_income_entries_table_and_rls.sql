-- Income ledger, part 1: snapshot, helper, table, indexes, RLS.
-- Replaces the scalar user_settings.income / biz_income / fam_income.

-- 0. SNAPSHOT before anything else. TransferMoneyModal.tsx:57 reads all three
-- columns with no error destructured and :95-102 writes all three back, so a
-- single failed read followed by a confirm writes biz_income = 0 over real
-- data. Business mode is closed, so nobody would notice. This is the only
-- recovery path if that has already happened.
-- RLS on with zero policies => service role only. Keep this table.
create table if not exists public.user_settings_income_backup_20260825 as
select user_id, income, biz_income, fam_income, now() as snapshot_at
from public.user_settings;

alter table public.user_settings_income_backup_20260825 enable row level security;
revoke all on public.user_settings_income_backup_20260825 from anon, authenticated;

-- 1. Two-argument sibling of is_approved_family_member(gid), which can only ask
-- about auth.uid(). The received_by write guard must validate a THIRD PARTY's
-- membership. SECURITY DEFINER so it can see family_links rows the caller's own
-- RLS would hide, without re-triggering policy evaluation and recursing.
create or replace function public.is_family_group_member(gid uuid, uid uuid)
returns boolean
language sql stable security definer set search_path = 'public'
as $$
  select gid is not null and uid is not null and exists (
    select 1 from family_links
    where group_id = gid and user_id = uid and approved is true
  )
$$;

revoke all on function public.is_family_group_member(uuid, uuid) from public, anon;
grant execute on function public.is_family_group_member(uuid, uuid) to authenticated;

-- 2. TABLE.
-- Money is numeric rands, matching expenses.amount — income is subtracted from
-- expenses in one expression (useOverviewStats.ts:80) so the types must match.
-- `date` is a real DATE, diverging from expenses.date (text). That text type is
-- why every month filter in the app is a client-side startsWith(); the
-- recurrence projection needs real server-side month arithmetic. PostgREST
-- serialises date as 'YYYY-MM-DD' so existing client code still works.
-- RECURRENCE IS A PROJECTION RULE, NOT MATERIALISED ROWS. expenses.recurring is
-- decoration — nothing generates a future row from it. If income copied that, a
-- salary entered in January would contribute R0 in February and every balance
-- would collapse.
create table if not exists public.income_entries (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  account_mode      text not null default 'personal'
                      check (account_mode in ('personal','business','family')),
  group_id          uuid references public.family_groups(id) on delete set null,
  -- WHICH MEMBER RECEIVED the money. The one divergence from the expense
  -- pattern, which attributes by author. A wife recording a gift her husband
  -- received cannot express that under author-attribution. NULL means "the
  -- author" — every read uses coalesce(received_by, user_id), so a row can
  -- never lose its dot. Inert outside Family mode.
  received_by       uuid references auth.users(id) on delete set null,
  -- > 0 is what makes "no negative rows" enforceable, which is what makes the
  -- move-between-modes design (re-tag account_mode, never a negative row) sound.
  amount            numeric not null check (amount > 0),
  category          text not null default 'Salary',
  description       text not null default '',
  -- For recurs = true this is the FIRST month the entry applies to.
  date              date not null,
  recurs            boolean not null default false,
  ends_on           date,
  -- Default true is the byte-identical choice: 10% of all entries == 10% of the
  -- single seeded entry == 10% of the old scalar, so the tithe autofill does not
  -- move on ship day.
  is_tithable       boolean not null default true,
  linked_account_id uuid references public.linked_accounts(id) on delete set null,
  source            text not null default 'manual'
                      check (source in ('manual','migrated','stokvel','csv','mono','payout')),
  created_at        timestamptz not null default now(),
  constraint income_entries_ends_after_start
    check (ends_on is null or ends_on >= date),
  constraint income_entries_ends_only_if_recurs
    check (ends_on is null or recurs)
);

comment on table public.income_entries is
  'Individual income entries. Replaces the scalar user_settings.income / biz_income / fam_income.';
comment on column public.income_entries.date is
  'Date received. For recurs=true this is the FIRST month the entry applies to.';
comment on column public.income_entries.received_by is
  'Family mode: which member the money went to. NULL means the author (user_id). Always read as coalesce(received_by, user_id).';
comment on column public.income_entries.recurs is
  'Projection rule, not a label. Evaluated at read time by income_for_months(). No future rows are materialised.';

-- 3. INDEXES.
create index if not exists income_entries_user_mode_date_idx
  on public.income_entries (user_id, account_mode, date desc);

create index if not exists income_entries_family_group_idx
  on public.income_entries (group_id)
  where account_mode = 'family';

-- MIGRATION IDEMPOTENCY. Not a nicety: a doubled seed DOUBLES every user's
-- balance. Partial unique index plus explicit conflict inference in part 2
-- makes re-running the seed provably safe.
create unique index if not exists income_entries_migrated_uniq
  on public.income_entries (user_id, account_mode)
  where source = 'migrated';

-- 4. RLS. Four clean owner policies rather than a copy of expenses' eight,
-- which accreted over four migrations and include an on-behalf-of insert.
-- Income needs no on-behalf-of write: received_by covers "this money is someone
-- else's" without granting cross-user writes.
alter table public.income_entries enable row level security;

drop policy if exists "income_entries_select_own" on public.income_entries;
create policy "income_entries_select_own"
  on public.income_entries for select
  using (user_id = auth.uid());

drop policy if exists "income_entries_insert_own" on public.income_entries;
create policy "income_entries_insert_own"
  on public.income_entries for insert
  with check (user_id = auth.uid());

-- UPDATE and DELETE stay OWN-ROW ONLY even though SELECT is group-wide,
-- identical to expenses. The client must apply the same isOwnRow guard before
-- offering edit/delete, and every write must .select('id') and treat zero rows
-- as failure — an action on a partner's row is otherwise a no-op that looks
-- like it worked.
drop policy if exists "income_entries_update_own" on public.income_entries;
create policy "income_entries_update_own"
  on public.income_entries for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "income_entries_delete_own" on public.income_entries;
create policy "income_entries_delete_own"
  on public.income_entries for delete
  using (user_id = auth.uid());

-- Family read REUSES can_read_family_expense rather than cloning it: the body is
-- table-agnostic (a gid + a mode, touching only family_links). Two copies would
-- have to agree forever, and the day they drift is the day income and expenses
-- disagree about who is in a household.
drop policy if exists "income_entries_select_family_group" on public.income_entries;
create policy "income_entries_select_family_group"
  on public.income_entries for select
  using (can_read_family_expense(group_id, account_mode));

-- Write guards. RESTRICTIVE and split INSERT/UPDATE, both deliberate:
--   * Postgres ORs permissive policies together, so a permissive guard WIDENS
--     access and closes nothing. Restrictive policies AND with the existing set.
--   * Not FOR ALL: a restrictive USING would also apply to SELECT and block a
--     user reading their own rows carrying a group they have since left.
-- Without these, group_id is forgeable and a user could inject income into
-- another household's ledger. The received_by clause is what makes that column
-- safe: attribute to yourself, or to an approved member of the group you are
-- writing into. Nothing else.
drop policy if exists "income_entries_write_guard_insert" on public.income_entries;
create policy "income_entries_write_guard_insert"
  on public.income_entries as restrictive for insert
  with check (
    (group_id is null or is_approved_family_member(group_id))
    and (
      received_by is null
      or received_by = user_id
      or is_family_group_member(group_id, received_by)
    )
  );

drop policy if exists "income_entries_write_guard_update" on public.income_entries;
create policy "income_entries_write_guard_update"
  on public.income_entries as restrictive for update
  using (true)
  with check (
    (group_id is null or is_approved_family_member(group_id))
    and (
      received_by is null
      or received_by = user_id
      or is_family_group_member(group_id, received_by)
    )
  );
