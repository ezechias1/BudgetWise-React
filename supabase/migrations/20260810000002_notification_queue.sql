-- Generic push-notification queue for adult-facing features (expense
-- review reminders today; anything else later). Deliberately separate from
-- `kid_notifications`, whose RLS lets a *kid* write into a *parent's* row —
-- a policy with no business existing on an adult financial-privacy feature.

create table if not exists notification_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('expense_review')),
  payload jsonb not null default '{}'::jsonb,
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'sent', 'cancelled')),
  created_at timestamptz not null default now()
);

create index if not exists notification_queue_pending_idx
  on notification_queue (status, scheduled_for);
create index if not exists notification_queue_user_id_idx
  on notification_queue (user_id);

alter table notification_queue enable row level security;

drop policy if exists "user manages own notification queue" on notification_queue;
create policy "user manages own notification queue"
  on notification_queue for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
