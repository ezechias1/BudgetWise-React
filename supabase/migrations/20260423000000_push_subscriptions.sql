-- Junior Phase 5 · push subscriptions
-- Stores web-push (VAPID) endpoints per parent. Schema reserves device_token
-- + platform='apns'|'fcm' for future native push (Capacitor) without a rewrite.

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  platform text not null default 'webpush'
    check (platform in ('webpush','apns','fcm')),

  -- web push fields (null for native)
  endpoint text,
  p256dh text,
  auth text,

  -- native push fields (null for webpush) — populated in a later phase
  device_token text,

  user_agent text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  -- webpush: endpoint is the natural dedup key
  -- native:  device_token is the natural dedup key
  constraint push_sub_dedup unique nulls not distinct (user_id, endpoint, device_token)
);

create index if not exists push_subscriptions_user_id_idx
  on push_subscriptions(user_id);

alter table push_subscriptions enable row level security;

create policy "user manages own push subs"
  on push_subscriptions for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
