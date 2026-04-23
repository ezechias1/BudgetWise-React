# BudgetWise Junior — Phase 5 — Server-side Web Push (Design Spec)

**Date:** 2026-04-23
**Author:** Ezechias + Claude
**Status:** Ready for plan
**Supersedes:** "Phase 5 (planned, not started)" stub in `memory/budgetwise.md`

---

## 1. Problem

BudgetWise Junior already enqueues parent-targeted notifications (`approval_nudge` from kids' actions, `sunday_reminder` for owed-amount nudges) into `kid_notifications`. Today, delivery happens entirely client-side:

- `setupParentNotificationPolling` (`src/lib/junior-notifications.ts`) drains the queue every 30 s from inside the parent's open tab and calls `swReg.showNotification`.
- `maybeFireSundayReminder` (`src/lib/junior-sunday-reminder.ts`) computes total owed and fires when the parent loads any page on a Sunday.

Both paths only work while the parent has the app open. With the tab closed, no notification is delivered. This phase adds a server-side sender so notifications land regardless of whether any parent tab is open.

## 2. Scope

In scope:

- **Web push (VAPID) only**, sent from a Supabase Edge Function on a `pg_cron` schedule.
- **Parent-targeted notifications only.** Schema is shaped to accept kid-targeted subs and native (APNs/FCM) device tokens later, but no kid push or native-app push is wired in this phase.
- **Both existing notification kinds** (`approval_nudge`, `sunday_reminder`) delivered through the new path.
- **Parent UX for opt-in / opt-out**, surfaced both contextually (Junior dashboard) and globally (Account page).

Out of scope:

- Native push via Capacitor (`@capacitor/push-notifications`, APNs, FCM). Schema reserves a `device_token` column and a `platform` enum so this can be added without a migration rewrite.
- Kid-targeted notifications.
- Notification kinds beyond the two above.
- Retry-attempt counter on `kid_notifications`. Every-minute cron retry is the v1 strategy; we'll add a counter only if rows get stuck pending in production.

## 3. Architecture

```
                                      ┌────────────────────────────┐
  Kid marks chore done  ─────────────▶│  kid_notifications         │
  (existing code in ChoresPage)       │  (status='pending')        │
                                      └────────────────────────────┘
                                                     │
  pg_cron @ * * * * *  (every 1 min)  ───┐           │
                                         ▼           ▼
                                ┌────────────────────────────┐
  pg_cron @ 0 7 * * 0 (Sun 9am SAST)──▶│  send-junior-push edge fn  │
  (enqueues sunday_reminder rows first) │  (--no-verify-jwt,         │
                                        │   x-cron-secret guarded)   │
                                        └────────────────────────────┘
                                                     │
                          fetch all push_subscriptions for row.user_id
                                                     │
                          web-push (VAPID-signed POST per endpoint)
                                                     │
                                                     ▼
                              ┌────────────────────────────┐
                              │  Browser push service      │
                              │  (FCM endpoint / Mozilla / │
                              │   Apple Web Push)          │
                              └────────────────────────────┘
                                                     │
                                                     ▼
                              ┌────────────────────────────┐
                              │  sw.js 'push' handler      │  ◀── already shipped
                              │  → showNotification()      │
                              └────────────────────────────┘
```

**New components:** `push_subscriptions` table, `send-junior-push` edge function, two pg_cron jobs, `src/lib/push-subscription.ts` client lib, `<PushPromptCard />` on `JuniorDashboardPage`, "Notifications" toggle on `AccountPage`.

**Reused components:** `kid_notifications` queue (unchanged), `sw.js` push handler (already shipped, untouched), `enqueueApprovalNudge` (unchanged), `setupParentNotificationPolling` (kept as fallback for tab-open users).

**Failure model:** edge function attempts every subscription per row; on `404`/`410` the subscription is deleted from `push_subscriptions`. On other errors the `kid_notifications` row stays `pending` and the next cron tick retries. No exponential backoff in v1 — every-minute retry is cheap.

## 4. Schema changes

### New table: `push_subscriptions`

```sql
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- future-proofing: webpush now, apns/fcm slot in later
  platform text not null default 'webpush'
    check (platform in ('webpush','apns','fcm')),

  -- web push fields (null for native)
  endpoint text,
  p256dh text,
  auth text,

  -- native push fields (null for webpush) — added now, populated later
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
```

**Notes:**
- `user_id` is the addressee. For Phase 5 that is always a parent. Future kid-targeted subs would insert with the kid's `auth_user_id`; no schema change needed.
- `nulls not distinct` requires Postgres 15+ (Supabase is on 15). Without it, two webpush subs with the same `endpoint` could coexist because of the NULL `device_token`.
- Service-role bypass is implicit; the edge function uses `SUPABASE_SERVICE_ROLE_KEY` to read all subs.

### Migration repair (because the table was already created out of band)

The `push_subscriptions` table was created by running the SQL directly in the Supabase SQL editor on 2026-04-23 during the design conversation. To realign the migration history with the database state:

```bash
# After creating the matching migration file at supabase/migrations/<ts>_push_subscriptions.sql
npx supabase@2.93.0 migration repair --status applied <ts>
```

### No changes to `kid_notifications`

The existing schema (`status`, `kind`, `payload`, `scheduled_for`, `sent_at`) already covers everything the sender needs.

## 5. Edge function: `send-junior-push`

Lives at `supabase/functions/send-junior-push/index.ts`. Deployed with `--no-verify-jwt` per the project's ES256-gateway gotcha (see `memory/reference_supabase_edge_jwt.md`).

```ts
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@^3.6';

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT')!,
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
);

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const CRON_SECRET = Deno.env.get('CRON_INVOKE_SECRET')!;

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response('forbidden', { status: 403 });
  }

  const { data: rows } = await sb
    .from('kid_notifications')
    .select('id, user_id, kind, payload')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .limit(200);
  if (!rows?.length) return Response.json({ drained: 0 });

  const userIds = [...new Set(rows.map(r => r.user_id))];
  const { data: subs } = await sb
    .from('push_subscriptions')
    .select('id, user_id, platform, endpoint, p256dh, auth')
    .in('user_id', userIds)
    .eq('platform', 'webpush');
  const byUser = Map.groupBy(subs ?? [], s => s.user_id);

  let sent = 0, gone = 0, failed = 0;
  for (const row of rows) {
    const built = buildPayload(row);
    if (!built) continue;

    const userSubs = byUser.get(row.user_id) ?? [];
    if (userSubs.length === 0) {
      await markSent(row.id);   // prevents queue from growing forever for opted-out users
      continue;
    }

    let anySuccess = false;
    for (const s of userSubs) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(built),
        );
        sent++; anySuccess = true;
      } catch (e: any) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await sb.from('push_subscriptions').delete().eq('id', s.id);
          gone++;
        } else {
          failed++;
        }
      }
    }
    if (anySuccess) await markSent(row.id);
    // else: stays pending, next cron tick retries
  }

  return Response.json({ drained: rows.length, sent, gone, failed });
});

function buildPayload(row: { kind: string; payload: any }) {
  if (row.kind === 'approval_nudge') {
    const { kid_name, action_type, item_title, link } = row.payload;
    if (action_type === 'chore') {
      return {
        title: `${kid_name} has a chore waiting`,
        body: `They marked "${item_title}" done — tap to approve.`,
        url: link,
      };
    }
    if (action_type === 'mission') {
      return {
        title: `${kid_name} finished a money mission`,
        body: `They completed "${item_title}" — tap to review.`,
        url: link,
      };
    }
    return null;
  }
  if (row.kind === 'sunday_reminder') {
    const { total_owed_cents, kids_count } = row.payload;
    return {
      title: 'Sunday settle-up',
      body: `You owe your kids R${(total_owed_cents/100).toFixed(2)} across ${kids_count} ${kids_count === 1 ? 'child' : 'children'}. Tap to settle.`,
      url: '/dashboard/junior',
    };
  }
  return null;
}

function markSent(id: string) {
  return sb.from('kid_notifications')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', id);
}
```

### Why `npm:web-push`

Most battle-tested VAPID library, available on Supabase Edge Runtime via the `npm:` specifier. If runtime compatibility issues surface in deployment, the fallback is `jsr:@negrel/webpush` (Deno-native). Decision deferred to execution-phase verification.

### Body strings match the existing client poller

`buildPayload` produces identical title/body strings to `buildNotification` in `src/lib/junior-notifications.ts`. This means the parent can't tell whether a notification was delivered by the client poller or the server cron — both look identical.

## 6. pg_cron jobs and Sunday enqueue

Lives at `supabase/migrations/<ts>_junior_push_cron.sql`.

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Helper that fetches the secret from Vault and posts to the function
create or replace function junior.invoke_send_push() returns void language plpgsql as $$
declare
  secret text;
begin
  select decrypted_secret into secret
    from vault.decrypted_secrets where name = 'cron_invoke_secret';
  perform net.http_post(
    url     := 'https://trkdlwukjyupvvcyzebf.supabase.co/functions/v1/send-junior-push',
    headers := jsonb_build_object(
      'content-type',  'application/json',
      'x-cron-secret', secret,
      'apikey',        current_setting('app.settings.anon_key', true)
    ),
    body    := '{}'::jsonb
  );
end $$ security definer;

select cron.schedule(
  'send-junior-push',
  '* * * * *',
  $$ select junior.invoke_send_push(); $$
);

select cron.schedule(
  'enqueue-sunday-reminder',
  '0 7 * * 0',                      -- 7am UTC = 9am SAST (no DST)
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

-- Belt-and-suspenders: prevent double-enqueue per ISO week
create unique index if not exists kid_notifications_sunday_dedup
  on kid_notifications (user_id, (date_trunc('week', scheduled_for)))
  where kind = 'sunday_reminder';
```

**Vault secret (one-time, run by hand):**

```sql
select vault.create_secret('<random 32-byte hex>', 'cron_invoke_secret');
```

The same value goes into the edge function's `CRON_INVOKE_SECRET` env var.

**SAST is UTC+2 with no DST**, so `0 7 * * 0` is 9am SA every Sunday year-round.

**Sunday enqueue runs purely in SQL** — no second edge function. The every-minute drainer picks up the rows within 60 s.

## 7. Client-side subscribe flow

### `src/lib/push-subscription.ts` (new)

```ts
import { supabase } from '@/lib/supabase';

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY as string;

function urlBase64ToUint8Array(b64: string): Uint8Array {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

export interface PushStatus {
  supported: boolean;
  permission: NotificationPermission;
  subscribed: boolean;
}

export async function getPushStatus(): Promise<PushStatus> {
  const supported = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
  if (!supported) return { supported: false, permission: 'default', subscribed: false };
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return { supported: true, permission: Notification.permission, subscribed: sub !== null };
}

export async function enablePush(): Promise<boolean> {
  if (Notification.permission === 'default') {
    const result = await Notification.requestPermission();
    if (result !== 'granted') return false;
  }
  if (Notification.permission !== 'granted') return false;

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
    });
  }
  const json = sub.toJSON();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;

  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: user.id,
    platform: 'webpush',
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    user_agent: navigator.userAgent,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'user_id,endpoint,device_token' });
  return !error;
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    await supabase.from('push_subscriptions').delete()
      .eq('user_id', user.id).eq('endpoint', endpoint);
  }
}
```

### Surface 1: `<PushPromptCard />` on `JuniorDashboardPage`

A new card rendered above the per-kid cards. Conditions to show:

- `status.supported` is true
- `status.subscribed` is false
- `status.permission !== 'denied'`
- `localStorage.getItem('bw-junior-push-prompt-dismissed') !== '1'`

Body copy: "Get notified when your kid finishes a chore — even when the app is closed."

Buttons:
- **Enable** → calls `enablePush()`. On success refresh status. On failure (permission denied) set the dismissed flag and direct the user to AccountPage for the recovery path.
- **Not now** → set the dismissed flag.

### Surface 2: "Notifications" toggle on `AccountPage`

Permanent on/off switch:

- `!status.supported` → "Push notifications aren't supported on this browser." (no toggle)
- `status.permission === 'denied'` → "You blocked notifications. Re-enable them in your browser settings, then toggle on here." (no toggle)
- Otherwise → toggle bound to `status.subscribed`. ON → `enablePush()`. OFF → `disablePush()`.

### iOS gotcha

iOS Safari only supports web push for PWAs **installed to the home screen** on iOS 16.4+. `getPushStatus()` will report `supported: false` on Safari mobile that isn't installed. The Account-page copy already covers that case.

## 8. What gets deleted

- **`src/lib/junior-sunday-reminder.ts`** — deleted in full. Server now owns Sunday reminders. Leaving this in place would cause duplicate notifications on Sunday (one from the parent's tab, one from server-side push) because the localStorage dedup the client uses can't see what the server sent.
- **The caller of `maybeFireSundayReminder` in `src/components/DashboardLayout.tsx`** — removed.

`setupParentNotificationPolling` and `enqueueApprovalNudge` stay as-is. The polling-vs-cron race is naturally deduped by the queue row's `status` field — whichever path marks it `sent` first wins, the other skips.

## 9. Setup steps (run before any client code ships)

Ordered. Each becomes one or more atomic commits in the implementation plan.

1. **Generate VAPID keys locally:** `npx web-push generate-vapid-keys`. Outputs a public + private key. Generate the cron secret with `openssl rand -hex 32`.
2. **Set Supabase function secrets** (one-time, run from `~/Desktop/BudgetWise-React`):
   ```bash
   npx supabase@2.93.0 secrets set \
     VAPID_PUBLIC_KEY=... \
     VAPID_PRIVATE_KEY=... \
     VAPID_SUBJECT=mailto:downdogmedia.co@gmail.com \
     CRON_INVOKE_SECRET=...
   ```
3. **Set Vercel env var:** `VITE_VAPID_PUBLIC_KEY` = same public key. Public by design (it's embedded in the client bundle).
4. **Set Supabase Vault secret** (one-time, via SQL editor):
   ```sql
   select vault.create_secret('<the cron secret>', 'cron_invoke_secret');
   ```
   Same value as the function's `CRON_INVOKE_SECRET`.
5. **Create the matching migration file** for `push_subscriptions` (the table is already in the database from the design conversation), commit, then `npx supabase@2.93.0 migration repair --status applied <ts>`.
6. **Deploy the edge function:** `npx supabase@2.93.0 functions deploy send-junior-push --no-verify-jwt`.
7. **Run the cron migration** (creates the two pg_cron jobs). The every-minute drain hits the now-deployed function.
8. **Bump `public/sw.js` cache version** v8 → v9. Forces clean SW reload on next deploy.
9. **Ship the client subscribe code, JuniorDashboardPage prompt, AccountPage toggle, deletion of `maybeFireSundayReminder`** via `npm run deploy`.

## 10. Testing & verification

- **Local subscribe flow:** in dev, click Enable on the prompt → browser permission dialog appears → after Allow, a row appears in `push_subscriptions` with the right `endpoint`/`p256dh`/`auth`.
- **Manual queue insert (approval_nudge):**
  ```sql
  insert into kid_notifications (user_id, kind, payload, status)
  values ('<your auth uid>', 'approval_nudge',
    '{"kid_name":"Test","action_type":"chore","item_title":"feed dog","link":"/dashboard/chores"}'::jsonb,
    'pending');
  ```
  Within 60 s the notification appears on the device — even with the app closed.
- **Cron drain visible:** Supabase function logs show one `send-junior-push` invocation per minute with `{drained, sent, gone, failed}` counts.
- **Sunday reminder dry run:** manually run the Sunday `INSERT ... SELECT` once to confirm it generates the right rows. Let the actual cron fire it the following Sunday for the live test.
- **Revoke path:** flip the Account toggle off → the row disappears from `push_subscriptions`. Manually insert another `kid_notifications` row → function marks it `sent` (no subs, but row not stuck pending). Phone gets nothing.
- **Dead subscription handling:** uninstall the PWA on the phone (or block notifications in browser settings). Send another notification. Function logs show `gone: 1` and the dead sub is auto-deleted from `push_subscriptions`.
- **No-dupe verification:** with the app open in a parent tab AND push permission granted, insert one row. Confirm only ONE notification fires (whichever path wins the race marks the row `sent`, the other skips).

## 11. Open questions deferred to plan / execute

- **`npm:web-push` vs `jsr:@negrel/webpush`** — confirm the `npm:` import works on the current Supabase Edge Runtime version during execution. If not, swap to the JSR package; API is similar.
- **Anon-key GUC vs hardcoded header** — `current_setting('app.settings.anon_key', true)` in the cron helper assumes the anon key is set as a database GUC. If it isn't (likely not by default), either hardcode the anon key in the migration (it's public, low-risk) or set the GUC via `ALTER DATABASE postgres SET app.settings.anon_key = '...'` once.
- **Push prompt copy** — the body text on `<PushPromptCard />` ("Get notified when your kid finishes a chore — even when the app is closed.") is a first draft. Final wording can be tightened during execution.

## 12. Non-goals / explicitly deferred

- Native push via Capacitor (APNs/FCM). Schema reserves `device_token` and `platform = 'apns' | 'fcm'`; sender currently filters to `platform = 'webpush'`. Adding native delivery later is one new sender branch + one client integration, no schema migration.
- Kid-targeted notifications.
- Notification kinds beyond `approval_nudge` and `sunday_reminder`.
- Per-user timezone for the Sunday reminder. Currently fires at 9am SAST for everyone. If non-SA users grow, store timezone on `user_settings` and switch to per-row scheduling.
- Web push payload encryption beyond what `web-push` does by default (which is fine — it already does ECDH + AES-GCM per spec).
- Retry counter / dead-letter handling for stuck `pending` rows. Cron retries forever today; revisit if rows accumulate.
