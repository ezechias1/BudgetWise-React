-- Junior Phase 5 · two pg_cron jobs:
--   1. send-junior-push           — every minute, drain kid_notifications.
--   2. enqueue-sunday-reminder    — Sunday 7am UTC (= 9am SAST, no DST),
--                                   pre-fill queue with sunday_reminder rows.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Helper that fetches the cron-invoke secret from Vault and posts to the
-- send-junior-push edge function. SECURITY DEFINER so the cron worker can
-- read the Vault secret regardless of caller perms.
create or replace function public.invoke_send_junior_push() returns void
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
    url     := 'https://trkdlwukjyupvvcyzebf.supabase.co/functions/v1/send-junior-push',
    headers := jsonb_build_object(
      'content-type',  'application/json',
      'x-cron-secret', secret
    ),
    body    := '{}'::jsonb
  );
end $$;

-- Drain queue every minute.
select cron.schedule(
  'send-junior-push',
  '* * * * *',
  $$ select public.invoke_send_junior_push(); $$
);

-- Enqueue Sunday reminders at 7am UTC (= 9am SAST, no DST).
select cron.schedule(
  'enqueue-sunday-reminder',
  '0 7 * * 0',
  $$
  insert into kid_notifications (user_id, kind, payload, scheduled_for, status)
  select
    user_id,
    'sunday_reminder',
    jsonb_build_object(
      'total_owed_cents', sum(amount_cents)::int,
      'kids_count',       count(distinct member_id)::int
    ),
    now(),
    'pending'
  from kid_ledger
  where status = 'owed'
  group by user_id
  having sum(amount_cents) > 0
  on conflict do nothing;
  $$
);

-- Note: no per-week unique index. date_trunc('week', timestamptz) is STABLE,
-- not IMMUTABLE, so it can't be used in an index expression. pg_cron is
-- single-fire per schedule; double-enqueue would require a manual rerun, in
-- which case duplicates are acceptable. The `on conflict do nothing` above
-- becomes a no-op without a target constraint; left in place for future
-- safety if a dedup mechanism is added later.
