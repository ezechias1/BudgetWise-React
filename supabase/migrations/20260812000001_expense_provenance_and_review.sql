-- ============================================================
-- Expense provenance + review queue.
--
-- Prerequisite for automatic bank import (Mono, South Africa). Imported
-- transactions must not go straight into the ledger: `expenses` feeds
-- totals, budget warnings and the pie chart, so uncategorised
-- auto-inserted rows would silently corrupt all three. They land as
-- `review_status = 'pending'` and are promoted on confirmation.
--
-- This is ALSO the fix for the stokvel double-count bug, not just prep
-- work next to it. StokvelPage writes each contribution to both
-- `stokvel_contributions` and `expenses` (so it shows in totals). Once
-- bank import is live the same contribution also arrives as a bank
-- debit — `source` is what lets the dedupe matcher tell them apart.
--
-- text + check constraints rather than native enums, matching the
-- established pattern (no Postgres enums exist anywhere in the previous
-- 9 migrations).
-- ============================================================

alter table expenses
  add column if not exists source text not null default 'manual',
  add column if not exists review_status text not null default 'confirmed',
  add column if not exists external_id text,
  add column if not exists linked_account_id uuid;

-- Defaults keep every existing row untouched: pre-existing expenses are
-- 'manual' and 'confirmed', so they stay in the ledger exactly as now.
alter table expenses drop constraint if exists expenses_source_check;
alter table expenses add constraint expenses_source_check
  check (source in ('manual', 'csv', 'mono', 'alert', 'stokvel'));

alter table expenses drop constraint if exists expenses_review_status_check;
alter table expenses add constraint expenses_review_status_check
  check (review_status in ('pending', 'confirmed', 'dismissed'));

-- on delete set null, matching how trip_id already behaves: unlinking a
-- bank account must never cascade-delete real expense history.
alter table expenses drop constraint if exists expenses_linked_account_id_fkey;
alter table expenses add constraint expenses_linked_account_id_fkey
  foreign key (linked_account_id) references linked_accounts (id)
  on delete set null;

-- ⚠️ Deliberately NOT scoped by account_mode.
--
-- linked_accounts rows carry account_mode, so the same real-world bank
-- account linked in both Personal and Family mode exists as two separate
-- rows (useLinkedAccounts already detects this and warns via
-- CrossModeDepositBanner, but does not dedupe). A
-- (user_id, account_mode, external_id) constraint would let every
-- cross-mode account double-count every transaction, silently and
-- permanently.
--
-- Load-bearing assumption: the provider's transaction id is stable and
-- unique per real transaction regardless of which linked_accounts row
-- polled it. Confirm against Mono's docs before relying on this — if
-- their ids turn out to be per-connection rather than per-transaction,
-- this index is the wrong shape and the matcher needs amount+date+
-- merchant fuzzy matching instead.
create unique index if not exists expenses_user_external_uniq
  on expenses (user_id, external_id)
  where external_id is not null;

-- Review queue lookups are always "my pending rows".
create index if not exists expenses_review_pending_idx
  on expenses (user_id, review_status)
  where review_status = 'pending';

-- Backfill stokvel-written rows so the dedupe matcher can recognise them.
-- StokvelPage inserts with category 'Stokvel' and account_mode 'personal'
-- (see the contribution handler in src/pages/StokvelPage.tsx).
--
-- Caveat: this matches on category, so an expense a user typed by hand
-- and filed under Stokvel is relabelled too. That is acceptable — such a
-- row genuinely is stokvel spending, and the only consequence is that
-- the matcher treats it as stokvel-originated.
update expenses
  set source = 'stokvel'
  where category = 'Stokvel'
    and source = 'manual';

-- NOTE: pending rows are excluded from the ledger at QUERY level, not by
-- RLS. RLS answers "may this user see this row at all" (they own it, so
-- yes); review_status answers "should it count in the default view",
-- which is a different concern. A blanket policy hiding pending rows
-- would break the review queue itself, since that view must deliberately
-- select review_status = 'pending'. Same reasoning as the existing
-- trip_id / business_expense filter in useExpenses.ts.
