-- Trip expense review — supporting columns.
--
-- linked_accounts gains a way to mark an account as a company-issued card
-- (as opposed to the user's own money) and an explicit provider discriminator
-- so the future Stitch sync job doesn't have to guess from the shape of
-- plaid_access_token. expenses gains sync idempotency + repeat-notification
-- debounce columns used by the review-reminder cron (see
-- 20260810000003_expense_review_push_cron.sql).

alter table linked_accounts
  add column if not exists is_business_card boolean not null default false,
  add column if not exists provider text not null default 'manual'
    check (provider in ('manual', 'stitch'));

comment on column linked_accounts.is_business_card is
  'True for a company-issued card. Transactions synced from such an account '
  'always need a Business/Personal review decision, even inside a trip window.';

-- Lets the Stitch OAuth callback upsert idempotently (re-linking the same
-- account shouldn't create duplicate rows).
create unique index if not exists linked_accounts_user_account_idx
  on linked_accounts (user_id, account_id)
  where account_id is not null;

alter table expenses
  add column if not exists external_ref text,
  add column if not exists review_notified_at timestamptz;

comment on column expenses.external_ref is
  'Provider transaction id (e.g. Stitch) used to dedupe synced imports.';

create unique index if not exists expenses_user_external_ref_idx
  on expenses (user_id, external_ref)
  where external_ref is not null;

create index if not exists expenses_pending_review_idx
  on expenses (user_id, review_notified_at)
  where trip_id is not null and business_expense is null;
