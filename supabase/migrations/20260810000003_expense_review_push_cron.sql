-- Trip expense review — two pg_cron jobs, mirroring
-- 20260423000001_junior_push_cron.sql's shape exactly:
--   1. enqueue-expense-review-reminders — every 30 min, find expenses still
--      pending review and (re-)queue a notification if it's been a while.
--   2. send-expense-review-push        — every minute, drain notification_queue.
-- Reuses the same 'cron_invoke_secret' Vault entry the Junior cron already
-- set up — no new secret needed for this piece.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.enqueue_expense_review_reminders() returns void
language plpgsql security definer as $$
declare
  due_ids uuid[];
begin
  select array_agg(id) into due_ids
  from expenses
  where trip_id is not null
    and business_expense is null
    and (review_notified_at is null or review_notified_at < now() - interval '30 minutes');

  if due_ids is null or array_length(due_ids, 1) is null then
    return;
  end if;

  insert into notification_queue (user_id, kind, payload, scheduled_for, status)
  select
    e.user_id,
    'expense_review',
    jsonb_build_object(
      'expense_id', e.id,
      'description', e.description,
      'amount', e.amount,
      'date', e.date
    ),
    now(),
    'pending'
  from expenses e
  where e.id = any(due_ids);

  update expenses set review_notified_at = now() where id = any(due_ids);
end $$;

select cron.schedule(
  'enqueue-expense-review-reminders',
  '*/30 * * * *',
  $$ select public.enqueue_expense_review_reminders(); $$
);

create or replace function public.invoke_send_expense_review_push() returns void
language plpgsql security definer as $$
declare
  secret text;
begin
  select decrypted_secret into secret
    from vault.decrypted_secrets where name = 'cron_invoke_secret';
  if secret is null then
    raise exception 'cron_invoke_secret missing from vault';
  end if;
  perform net.http_post(
    url     := 'https://trkdlwukjyupvvcyzebf.supabase.co/functions/v1/send-expense-review-push',
    headers := jsonb_build_object(
      'content-type',  'application/json',
      'x-cron-secret', secret
    ),
    body    := '{}'::jsonb
  );
end $$;

select cron.schedule(
  'send-expense-review-push',
  '* * * * *',
  $$ select public.invoke_send_expense_review_push(); $$
);
