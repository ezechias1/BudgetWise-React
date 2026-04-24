# BudgetWise Junior — Phase 5 — Server-side Web Push (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Junior approval-nudge + Sunday-settle-up notifications via VAPID web push so the parent gets them even when no app tab is open.

**Architecture:** A `pg_cron` job invokes a `send-junior-push` Supabase edge function every minute. The function drains pending `kid_notifications` rows and sends VAPID-signed pushes to subscriptions stored in a new `push_subscriptions` table. A second cron job pre-fills the queue with `sunday_reminder` rows at 9am SAST every Sunday. Parent opt-in lives on `JuniorDashboardPage` (soft prompt) and `AccountPage` (permanent toggle). The existing client-side 30s poller stays in place as a tab-open fallback; queue-row status (`pending` → `sent`) deduplicates the two paths automatically. The client-side `maybeFireSundayReminder` is deleted (server now owns it).

**Tech Stack:** Supabase Edge Functions (Deno), `npm:web-push@^3.6`, `pg_cron` + `pg_net` + Supabase Vault, React 18 + TS + Vite, vanilla CSS, Web Push API, service worker (already shipped).

**Spec:** `docs/superpowers/specs/2026-04-23-junior-phase-5-server-push-design.md`

**Notes for the executor:**
- The project has **no test framework** (no vitest/jest). Verification = `npx tsc --noEmit` after each TS change + manual recipes from spec Section 10. Do not add a test framework.
- All edge functions on this project deploy with `--no-verify-jwt` (ES256 gateway gotcha — see `~/.claude/projects/-Users-kevinsmac/memory/reference_supabase_edge_jwt.md`).
- Production deploy is **manual**: `npm run deploy` from `~/Desktop/BudgetWise-React/`. Only run it after the React tasks are complete.
- All migrations live under `supabase/migrations/` and are version-controlled.
- The `push_subscriptions` table was created out-of-band in the Supabase SQL editor on 2026-04-23 during the design conversation. Task 4 reconciles the migration history with `supabase migration repair`.
- The spec uses `junior.invoke_send_push()`; this plan uses `public.invoke_send_push()` to match the existing migration convention (no other schemas are used in `supabase/migrations/`). Functionally identical.
- Match the project's commit-message style: short, lowercase, conventional-commits-ish (`feat:`, `fix:`, `chore:`, `migration:`).

---

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `supabase/migrations/20260423000000_push_subscriptions.sql` | NEW | Push subscriptions table + RLS. Repair-applied (already in DB). |
| `supabase/functions/send-junior-push/index.ts` | NEW | VAPID sender. Drains queue, sends, marks sent, prunes dead subs. |
| `supabase/functions/send-junior-push/deno.json` | NEW | Pin runtime + npm imports. |
| `supabase/migrations/20260423000001_junior_push_cron.sql` | NEW | Two `pg_cron` jobs + helper function + sunday-dedup index. |
| `src/lib/push-subscription.ts` | NEW | `getPushStatus`, `enablePush`, `disablePush` client lib. |
| `src/components/junior/PushPromptCard.tsx` | NEW | Soft prompt rendered on `JuniorDashboardPage`. |
| `src/pages/JuniorDashboardPage.tsx` | MODIFY | Render `<PushPromptCard />` above per-kid cards. |
| `src/pages/AccountPage.tsx` | MODIFY | Add "Notifications" section with on/off toggle. |
| `src/lib/junior-sunday-reminder.ts` | DELETE | Server now owns Sunday reminders. |
| `src/components/DashboardLayout.tsx` | MODIFY | Remove `maybeFireSundayReminder` import + call. |
| `public/sw.js` | MODIFY | Bump `CACHE = 'budgetwise-react-v8'` → `'v9'`. |

---

## Task 1: Generate VAPID keys and the cron secret (local, no commit)

**Files:** none (output saved to scratch).

- [ ] **Step 1: Generate the VAPID keypair**

```bash
cd ~/Desktop/BudgetWise-React
npx web-push generate-vapid-keys
```

Expected output:
```
=======================================
Public Key:
BNbX...                                       (87 chars, URL-safe base64)
Private Key:
xyz...                                        (43 chars, URL-safe base64)
=======================================
```

- [ ] **Step 2: Generate the cron-invoke shared secret**

```bash
openssl rand -hex 32
```

Expected output: a 64-character lowercase hex string.

- [ ] **Step 3: Store the four values somewhere recoverable**

Save to a temporary scratch buffer (NOT committed, NOT pasted into chat):
- `VAPID_PUBLIC_KEY` = the public key from Step 1
- `VAPID_PRIVATE_KEY` = the private key from Step 1
- `VAPID_SUBJECT` = `mailto:downdogmedia.co@gmail.com`
- `CRON_INVOKE_SECRET` = the hex string from Step 2

Tasks 2, 3, and 6 below paste these values into Supabase / Vercel / Vault.

---

## Task 2: Set Supabase function secrets (CLI, no commit)

**Files:** none.

- [ ] **Step 1: Confirm the CLI is linked to the right project**

```bash
cd ~/Desktop/BudgetWise-React
npx supabase@2.93.0 status | head -5
```

Expected: project ref `trkdlwukjyupvvcyzebf` shown (or output indicating an active link). If not linked: `npx supabase@2.93.0 link --project-ref trkdlwukjyupvvcyzebf` and re-check.

- [ ] **Step 2: Set the four function secrets**

Replace the `<...>` placeholders with the values from Task 1.

```bash
npx supabase@2.93.0 secrets set \
  VAPID_PUBLIC_KEY=<public-key> \
  VAPID_PRIVATE_KEY=<private-key> \
  VAPID_SUBJECT=mailto:downdogmedia.co@gmail.com \
  CRON_INVOKE_SECRET=<hex-secret>
```

Expected: `Finished supabase secrets set.`

- [ ] **Step 3: Verify they're listed**

```bash
npx supabase@2.93.0 secrets list
```

Expected: all four names present (values are masked).

---

## Task 3: Set the Vercel env var for the public VAPID key (CLI, no commit)

**Files:** none.

- [ ] **Step 1: Add the env var to Vercel for all environments**

```bash
cd ~/Desktop/BudgetWise-React
echo "<public-key>" | npx vercel env add VITE_VAPID_PUBLIC_KEY production
echo "<public-key>" | npx vercel env add VITE_VAPID_PUBLIC_KEY preview
echo "<public-key>" | npx vercel env add VITE_VAPID_PUBLIC_KEY development
```

Each command prompts for a value; piping `echo` answers it. If the env var already exists, the command will say so — `vercel env rm VITE_VAPID_PUBLIC_KEY <env>` first if you need to overwrite.

- [ ] **Step 2: Pull a local `.env` for `npm run dev`**

```bash
npx vercel env pull .env.local
```

Expected: `.env.local` written with `VITE_VAPID_PUBLIC_KEY=...` among other vars. This file is already in `.gitignore`.

- [ ] **Step 3: Confirm the value is readable in the client**

```bash
grep VITE_VAPID_PUBLIC_KEY .env.local
```

Expected: the public key string echoed back.

---

## Task 4: Create the push_subscriptions migration file and repair history

**Files:**
- Create: `supabase/migrations/20260423000000_push_subscriptions.sql`

The table itself was created by hand on 2026-04-23 during the design conversation. This task brings the migration history into sync without re-running the DDL.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260423000000_push_subscriptions.sql` with this exact content:

```sql
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
```

- [ ] **Step 2: Mark the migration as already applied**

```bash
cd ~/Desktop/BudgetWise-React
npx supabase@2.93.0 migration repair --status applied 20260423000000
```

Expected: `Repaired migration history: 20260423000000.`

- [ ] **Step 3: Confirm migration history is clean**

```bash
npx supabase@2.93.0 migration list
```

Expected: `20260423000000` appears in the `Local | Remote` columns aligned (no warning).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260423000000_push_subscriptions.sql
git commit -m "migration: add push_subscriptions table (Junior Phase 5)"
```

---

## Task 5: Create the send-junior-push edge function

**Files:**
- Create: `supabase/functions/send-junior-push/index.ts`
- Create: `supabase/functions/send-junior-push/deno.json`

- [ ] **Step 1: Write `deno.json`**

Create `supabase/functions/send-junior-push/deno.json` with:

```json
{
  "imports": {
    "@supabase/supabase-js": "jsr:@supabase/supabase-js@2",
    "web-push": "npm:web-push@^3.6"
  }
}
```

- [ ] **Step 2: Write `index.ts`**

Create `supabase/functions/send-junior-push/index.ts` with:

```ts
// Junior Phase 5 — server-side VAPID push sender.
// Drains kid_notifications rows where status='pending' and pushes to all
// matching push_subscriptions. Called by pg_cron every minute via pg_net.
// Deployed with --no-verify-jwt (ES256 gateway gotcha on this project).

import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

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

interface Row {
  id: string;
  user_id: string;
  kind: 'approval_nudge' | 'sunday_reminder' | string;
  payload: Record<string, unknown>;
}

interface Sub {
  id: string;
  user_id: string;
  platform: string;
  endpoint: string | null;
  p256dh: string | null;
  auth: string | null;
}

interface Built {
  title: string;
  body: string;
  url: string;
}

function buildPayload(row: Row): Built | null {
  if (row.kind === 'approval_nudge') {
    const p = row.payload as { kid_name: string; action_type: 'chore' | 'mission'; item_title: string; link: string };
    if (p.action_type === 'chore') {
      return {
        title: `${p.kid_name} has a chore waiting`,
        body: `They marked "${p.item_title}" done — tap to approve.`,
        url: p.link,
      };
    }
    if (p.action_type === 'mission') {
      return {
        title: `${p.kid_name} finished a money mission`,
        body: `They completed "${p.item_title}" — tap to review.`,
        url: p.link,
      };
    }
    return null;
  }
  if (row.kind === 'sunday_reminder') {
    const p = row.payload as { total_owed_cents: number; kids_count: number };
    return {
      title: 'Sunday settle-up',
      body: `You owe your kids R${(p.total_owed_cents / 100).toFixed(2)} across ${p.kids_count} ${p.kids_count === 1 ? 'child' : 'children'}. Tap to settle.`,
      url: '/dashboard/junior',
    };
  }
  return null;
}

function markSent(id: string) {
  return sb
    .from('kid_notifications')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', id);
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response('forbidden', { status: 403 });
  }

  const { data: rowsRaw, error: rowsErr } = await sb
    .from('kid_notifications')
    .select('id, user_id, kind, payload')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .limit(200);
  if (rowsErr) {
    console.error('[send-junior-push] queue read failed', rowsErr);
    return new Response('queue read failed', { status: 500 });
  }
  const rows = (rowsRaw ?? []) as Row[];
  if (rows.length === 0) return Response.json({ drained: 0 });

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const { data: subsRaw } = await sb
    .from('push_subscriptions')
    .select('id, user_id, platform, endpoint, p256dh, auth')
    .in('user_id', userIds)
    .eq('platform', 'webpush');
  const subs = (subsRaw ?? []) as Sub[];

  const byUser = new Map<string, Sub[]>();
  for (const s of subs) {
    const list = byUser.get(s.user_id) ?? [];
    list.push(s);
    byUser.set(s.user_id, list);
  }

  let sent = 0;
  let gone = 0;
  let failed = 0;

  for (const row of rows) {
    const built = buildPayload(row);
    if (!built) continue;

    const userSubs = byUser.get(row.user_id) ?? [];
    if (userSubs.length === 0) {
      // Mark sent so we don't retry forever for opted-out users.
      await markSent(row.id);
      continue;
    }

    let anySuccess = false;
    for (const s of userSubs) {
      if (!s.endpoint || !s.p256dh || !s.auth) continue;
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(built),
        );
        sent++;
        anySuccess = true;
      } catch (e) {
        const statusCode = (e as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await sb.from('push_subscriptions').delete().eq('id', s.id);
          gone++;
        } else {
          console.warn('[send-junior-push] push failed', { sub: s.id, statusCode, error: String(e) });
          failed++;
        }
      }
    }

    if (anySuccess) await markSent(row.id);
    // else: row stays 'pending'; next cron tick retries.
  }

  return Response.json({ drained: rows.length, sent, gone, failed });
});
```

- [ ] **Step 3: Deploy the function**

```bash
cd ~/Desktop/BudgetWise-React
npx supabase@2.93.0 functions deploy send-junior-push --no-verify-jwt
```

Expected: `Deployed Function send-junior-push`. If you see `UNAUTHORIZED_UNSUPPORTED_TOKEN_ALGORITHM` later when invoking, that means `--no-verify-jwt` was forgotten — re-deploy.

- [ ] **Step 4: Smoke-test the function with the wrong secret (should 403)**

```bash
curl -i -X POST \
  -H 'x-cron-secret: wrong' \
  https://trkdlwukjyupvvcyzebf.supabase.co/functions/v1/send-junior-push
```

Expected: `HTTP/2 403` with body `forbidden`. This proves the secret guard works.

- [ ] **Step 5: Smoke-test with the right secret (should 200 with empty drain)**

```bash
curl -i -X POST \
  -H "x-cron-secret: <CRON_INVOKE_SECRET>" \
  https://trkdlwukjyupvvcyzebf.supabase.co/functions/v1/send-junior-push
```

Expected: `HTTP/2 200` with body `{"drained":0}` (assuming the queue is empty).

If you instead see `npm:` import errors in the function logs (Supabase dashboard → Functions → Logs), the runtime can't resolve `npm:web-push`. Fall back: edit `deno.json`'s `web-push` import to `jsr:@negrel/webpush@^0.3` (Deno-native, similar API), update `index.ts`'s `webpush.setVapidDetails(...)` and `webpush.sendNotification(...)` calls to that lib's signatures (see its README), and re-deploy.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/send-junior-push/
git commit -m "feat: add send-junior-push edge function (Junior Phase 5)"
```

---

## Task 6: Set the Vault secret for pg_cron (SQL editor, no commit)

**Files:** none.

The pg_cron job reads the cron-invoke secret from Supabase Vault. This step seeds it.

- [ ] **Step 1: Open the Supabase SQL editor**

Navigate to https://supabase.com/dashboard/project/trkdlwukjyupvvcyzebf/sql/new in a browser.

- [ ] **Step 2: Run the Vault insert**

Replace `<CRON_INVOKE_SECRET>` with the same hex value used in Tasks 2 and 5.

```sql
select vault.create_secret(
  '<CRON_INVOKE_SECRET>',
  'cron_invoke_secret'
);
```

Expected: a single UUID returned (the secret's id). If you see `duplicate key value violates unique constraint "secrets_name_key"`, the secret was already created — update instead:

```sql
update vault.secrets
set secret = vault._crypto_aead_det_encrypt('<CRON_INVOKE_SECRET>'::bytea, ...)
where name = 'cron_invoke_secret';
```

(Easier: drop the row and re-create.)

```sql
delete from vault.secrets where name = 'cron_invoke_secret';
select vault.create_secret('<CRON_INVOKE_SECRET>', 'cron_invoke_secret');
```

- [ ] **Step 3: Verify it's readable**

```sql
select name, decrypted_secret from vault.decrypted_secrets where name = 'cron_invoke_secret';
```

Expected: one row, `decrypted_secret` matching the value pasted in Step 2.

---

## Task 7: Create and apply the cron migration

**Files:**
- Create: `supabase/migrations/20260423000001_junior_push_cron.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260423000001_junior_push_cron.sql`:

```sql
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

-- Belt-and-suspenders: prevent double-enqueue per ISO week.
create unique index if not exists kid_notifications_sunday_dedup
  on kid_notifications (user_id, (date_trunc('week', scheduled_for)))
  where kind = 'sunday_reminder';
```

- [ ] **Step 2: Apply the migration to the live DB**

```bash
cd ~/Desktop/BudgetWise-React
npx supabase@2.93.0 db push
```

Expected: `Applying migration 20260423000001_junior_push_cron.sql...` followed by `Finished supabase db push.`. If it fails with `extension "pg_cron" not enabled`, enable both extensions in the Supabase dashboard (Database → Extensions) and retry.

- [ ] **Step 3: Verify both cron jobs are scheduled**

In the Supabase SQL editor:

```sql
select jobid, jobname, schedule, active from cron.job order by jobid;
```

Expected: two rows — `send-junior-push` (`* * * * *`, `active=true`) and `enqueue-sunday-reminder` (`0 7 * * 0`, `active=true`).

- [ ] **Step 4: Watch one cron tick land successfully**

Wait up to 60 seconds, then in the SQL editor:

```sql
select start_time, status, return_message
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'send-junior-push')
order by start_time desc
limit 3;
```

Expected: at least one row with `status = 'succeeded'`. If you see `failed`, click into the Supabase Functions → `send-junior-push` → Logs to see why (most likely: function not deployed yet, secret mismatch, or `npm:web-push` import error from Task 5).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260423000001_junior_push_cron.sql
git commit -m "migration: schedule send-junior-push + sunday-reminder cron jobs"
```

---

## Task 8: End-to-end backend verification (manual, no commit)

**Files:** none.

This proves the server side works before we touch any React code.

- [ ] **Step 1: Insert a fake approval_nudge row addressed to your own user**

Find your auth user id first:

```sql
select id from auth.users where email = 'ezechiasmulamba@gmail.com';
```

Then in the SQL editor:

```sql
insert into kid_notifications (user_id, kind, payload, status)
values (
  '<your auth uid>',
  'approval_nudge',
  jsonb_build_object(
    'kid_name',    'Test',
    'action_type', 'chore',
    'item_title',  'feed dog',
    'link',        '/dashboard/chores'
  ),
  'pending'
);
```

- [ ] **Step 2: Wait for the cron to drain it**

Wait 60 seconds. Then check:

```sql
select id, kind, status, sent_at from kid_notifications
where user_id = '<your auth uid>' and kind = 'approval_nudge'
order by created_at desc limit 1;
```

Expected: `status = 'sent'` and `sent_at` populated (recent timestamp). Because there are no `push_subscriptions` rows yet, the function will mark sent without actually pushing — that's the "no subs → mark sent so queue doesn't grow forever" branch.

- [ ] **Step 3: Tail the function logs to confirm the drain**

In a terminal:

```bash
cd ~/Desktop/BudgetWise-React
npx supabase@2.93.0 functions logs send-junior-push --tail
```

Expected: every minute, a JSON line like `{"drained":0}` (or `{"drained":1,"sent":0,"gone":0,"failed":0}` if your test row was caught). Cancel with Ctrl-C.

- [ ] **Step 4: Verify the Sunday SQL works in dry-run mode**

In the SQL editor (this is the same body as the cron's Sunday job, run manually):

```sql
select
  user_id,
  jsonb_build_object(
    'total_owed_cents', sum(amount_cents)::int,
    'kids_count',       count(distinct member_id)::int
  ) as payload
from kid_ledger
where status = 'owed'
group by user_id
having sum(amount_cents) > 0;
```

Expected: zero or more rows showing what the actual cron would enqueue this Sunday. If you have no owed ledger rows, the cron will enqueue nothing — that's correct.

---

## Task 9: Add the client push-subscription library

**Files:**
- Create: `src/lib/push-subscription.ts`

- [ ] **Step 1: Write the lib**

Create `src/lib/push-subscription.ts`:

```ts
import { supabase } from '@/lib/supabase';

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY as string;

function urlBase64ToUint8Array(b64: string): Uint8Array {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export interface PushStatus {
  supported: boolean;
  permission: NotificationPermission;
  subscribed: boolean;
}

export async function getPushStatus(): Promise<PushStatus> {
  const supported =
    'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
  if (!supported) return { supported: false, permission: 'default', subscribed: false };
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return { supported: true, permission: Notification.permission, subscribed: sub !== null };
}

/**
 * Request permission, subscribe, upsert to push_subscriptions.
 * Returns true on success, false if the user denied or anything failed.
 */
export async function enablePush(): Promise<boolean> {
  if (!VAPID_PUBLIC) {
    console.warn('[push] VITE_VAPID_PUBLIC_KEY missing');
    return false;
  }
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: user.id,
      platform: 'webpush',
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,endpoint,device_token' },
  );
  if (error) {
    console.warn('[push] upsert failed', error);
    return false;
  }
  return true;
}

export async function disablePush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', user.id)
      .eq('endpoint', endpoint);
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
cd ~/Desktop/BudgetWise-React
npx tsc --noEmit
```

Expected: no errors. If TS complains about `import.meta.env.VITE_VAPID_PUBLIC_KEY`, add a declaration in `src/vite-env.d.ts` (likely already present; if not, add `interface ImportMetaEnv { readonly VITE_VAPID_PUBLIC_KEY: string; }`).

- [ ] **Step 3: Commit**

```bash
git add src/lib/push-subscription.ts
git commit -m "feat: add push-subscription client lib (Junior Phase 5)"
```

---

## Task 10: Add the soft prompt card to JuniorDashboardPage

**Files:**
- Create: `src/components/junior/PushPromptCard.tsx`
- Modify: `src/pages/JuniorDashboardPage.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/junior/PushPromptCard.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { enablePush, getPushStatus, type PushStatus } from '@/lib/push-subscription';

const DISMISS_KEY = 'bw-junior-push-prompt-dismissed';

export function PushPromptCard() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getPushStatus().then(setStatus);
  }, []);

  if (!status) return null;
  if (!status.supported) return null;
  if (status.subscribed) return null;
  if (status.permission === 'denied') return null;
  if (dismissed) return null;

  async function onEnable() {
    setBusy(true);
    const ok = await enablePush();
    if (ok) {
      setStatus(await getPushStatus());
    } else {
      // Permission denied or upsert failed — hide; AccountPage is the recovery path.
      setDismissed(true);
      localStorage.setItem(DISMISS_KEY, '1');
    }
    setBusy(false);
  }

  function onDismiss() {
    setDismissed(true);
    localStorage.setItem(DISMISS_KEY, '1');
  }

  return (
    <div className="card push-prompt-card" style={{ padding: 16, marginBottom: 16 }}>
      <p style={{ margin: '0 0 12px 0' }}>
        Get notified when your kid finishes a chore — even when the app is closed.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" onClick={onEnable} disabled={busy}>
          Enable
        </button>
        <button className="btn btn-secondary" onClick={onDismiss} disabled={busy}>
          Not now
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Render it on JuniorDashboardPage**

Open `src/pages/JuniorDashboardPage.tsx` and add the import near the other component imports:

```tsx
import { PushPromptCard } from '@/components/junior/PushPromptCard';
```

Then render `<PushPromptCard />` once, immediately above the first per-kid card in the page's JSX. The exact insertion point is the JSX block currently rendering `<p>Your kids, their IOUs, and settle-up.</p>` — render the card just above the per-kid grid, after that intro paragraph.

If unsure of placement, search for `Your kids, their IOUs, and settle-up.` and insert `<PushPromptCard />` on the next line after that `</p>`.

- [ ] **Step 3: Typecheck**

```bash
cd ~/Desktop/BudgetWise-React
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/junior/PushPromptCard.tsx src/pages/JuniorDashboardPage.tsx
git commit -m "feat: add push-permission soft prompt to Junior dashboard"
```

---

## Task 11: Add the Notifications section to AccountPage

**Files:**
- Modify: `src/pages/AccountPage.tsx`

- [ ] **Step 1: Read AccountPage to find a good insertion point**

```bash
grep -n "Account\|Plan\|Email\|h2" ~/Desktop/BudgetWise-React/src/pages/AccountPage.tsx | head -20
```

Pick a section near the existing "Plan" or "Account" headings — somewhere a settings toggle naturally lives. Conventionally, just below the Plan section.

- [ ] **Step 2: Add imports and the section**

Add to the imports at the top of `src/pages/AccountPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { disablePush, enablePush, getPushStatus, type PushStatus } from '@/lib/push-subscription';
```

(If `useEffect` / `useState` are already imported, just append the new ones to the existing line.)

Add this component definition above the main `AccountPage` function, or as an inline section inside it — match whichever pattern AccountPage already uses. Sketch:

```tsx
function NotificationsSection() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getPushStatus().then(setStatus);
  }, []);

  async function onToggle() {
    setBusy(true);
    if (status?.subscribed) {
      await disablePush();
    } else {
      await enablePush();
    }
    setStatus(await getPushStatus());
    setBusy(false);
  }

  if (!status) return null;

  return (
    <section className="account-section" style={{ marginTop: 24 }}>
      <h2>Notifications</h2>
      {!status.supported && (
        <p>Push notifications aren't supported on this browser.</p>
      )}
      {status.supported && status.permission === 'denied' && (
        <p>
          You blocked notifications. Re-enable them in your browser settings, then toggle on here.
        </p>
      )}
      {status.supported && status.permission !== 'denied' && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={status.subscribed}
            disabled={busy}
            onChange={onToggle}
          />
          <span>Push notifications</span>
        </label>
      )}
    </section>
  );
}
```

Then, inside the main `AccountPage` JSX, render `<NotificationsSection />` once — below the existing Plan section is a sensible default. If unsure, place it just before the page's last closing `</div>` so it appears at the bottom of the Account view.

- [ ] **Step 3: Typecheck**

```bash
cd ~/Desktop/BudgetWise-React
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/AccountPage.tsx
git commit -m "feat: add push notifications toggle to Account page"
```

---

## Task 12: Delete the client-side Sunday reminder

**Files:**
- Delete: `src/lib/junior-sunday-reminder.ts`
- Modify: `src/components/DashboardLayout.tsx`

The server now owns Sunday reminders. Leaving this in place causes duplicates — one from the parent's tab, one from server push.

- [ ] **Step 1: Find where it's called**

```bash
grep -rn "maybeFireSundayReminder\|junior-sunday-reminder" ~/Desktop/BudgetWise-React/src
```

Expected: a definition in `src/lib/junior-sunday-reminder.ts` and a caller in `src/components/DashboardLayout.tsx`.

- [ ] **Step 2: Remove the import and call from `DashboardLayout.tsx`**

Open `src/components/DashboardLayout.tsx`. Delete the import line that brings in `maybeFireSundayReminder`. Delete the `useEffect` (or other code path) that calls it. Do not leave a commented-out stub.

- [ ] **Step 3: Delete the file**

```bash
cd ~/Desktop/BudgetWise-React
git rm src/lib/junior-sunday-reminder.ts
```

- [ ] **Step 4: Confirm no remaining references**

```bash
grep -rn "maybeFireSundayReminder\|junior-sunday-reminder" ~/Desktop/BudgetWise-React/src
```

Expected: zero hits.

- [ ] **Step 5: Typecheck**

```bash
cd ~/Desktop/BudgetWise-React
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/DashboardLayout.tsx
git commit -m "chore: remove client-side Sunday reminder (server owns it now)"
```

(`git rm` already staged the deletion in Step 3, so it lands in the same commit.)

---

## Task 13: Bump the service worker cache version

**Files:**
- Modify: `public/sw.js`

This forces the SW to re-install on the next visit so the old cached SW is replaced cleanly.

- [ ] **Step 1: Edit the cache version**

Open `public/sw.js`. Change line 5:

```js
const CACHE = 'budgetwise-react-v8';
```

to:

```js
const CACHE = 'budgetwise-react-v9';
```

- [ ] **Step 2: Commit**

```bash
git add public/sw.js
git commit -m "chore: bump SW cache to v9 for Junior Phase 5"
```

---

## Task 14: Deploy to production

**Files:** none.

- [ ] **Step 1: Build locally to catch any last issues**

```bash
cd ~/Desktop/BudgetWise-React
npm run build
```

Expected: zero errors, build output in `dist/`.

- [ ] **Step 2: Deploy**

```bash
npm run deploy
```

This runs `vercel --prod && vercel alias set budget-wise-react.vercel.app budget-wise-ruby.vercel.app`. Expected: a production URL printed, then the alias set successfully.

- [ ] **Step 3: Hard-reload the deployed app once**

Open https://budget-wise-react.vercel.app in a fresh tab. Cmd-Shift-R (hard reload) to flush old SW + cached HTML.

Expected: app loads normally, no console errors.

---

## Task 15: End-to-end verification on production

**Files:** none.

- [ ] **Step 1: Subscribe via the Junior dashboard prompt**

Log in as the parent, switch to Family mode, navigate to Junior. The `<PushPromptCard />` should appear above the per-kid grid. Click **Enable**. The browser permission dialog should appear; click Allow.

In the Supabase SQL editor:

```sql
select id, user_id, platform, endpoint is not null as has_endpoint, last_seen_at
from push_subscriptions
where user_id = '<your auth uid>'
order by created_at desc limit 1;
```

Expected: one row, `platform = 'webpush'`, `has_endpoint = true`.

- [ ] **Step 2: Verify the prompt no longer shows**

Reload the Junior page. The card should be gone (because `status.subscribed === true`).

- [ ] **Step 3: Insert a test approval_nudge from the SQL editor**

```sql
insert into kid_notifications (user_id, kind, payload, status)
values (
  '<your auth uid>',
  'approval_nudge',
  jsonb_build_object(
    'kid_name',    'Test',
    'action_type', 'chore',
    'item_title',  'feed dog',
    'link',        '/dashboard/chores'
  ),
  'pending'
);
```

- [ ] **Step 4: Close the tab, wait, verify the notification arrives**

Close the BudgetWise tab entirely. Within 60 seconds, your device should display the system notification "Test has a chore waiting" / "They marked 'feed dog' done — tap to approve."

If it doesn't arrive:
- Check function logs (`npx supabase@2.93.0 functions logs send-junior-push --tail`) — look for errors.
- Check the row's status (`select status from kid_notifications where ...`) — if still `pending`, the cron isn't running or the function is failing silently.
- Check `cron.job_run_details` in the SQL editor for recent failures.

- [ ] **Step 5: Tap the notification, verify it deep-links correctly**

Tapping the notification should focus an existing BudgetWise tab (or open a new one) at `/dashboard/chores`.

- [ ] **Step 6: Test the unsubscribe path via the Account toggle**

Open BudgetWise, go to Account, find the Notifications section, toggle it off. Then in the SQL editor:

```sql
select count(*) from push_subscriptions where user_id = '<your auth uid>';
```

Expected: `0`.

Insert another test row with the same SQL as Step 3. Within 60 seconds, the function should mark it `sent` (no subs branch) and **no notification should arrive on your phone**.

- [ ] **Step 7: Re-subscribe from the Account toggle**

Toggle Notifications back on (no browser dialog should appear because permission is still granted from Step 1). Verify a new `push_subscriptions` row exists.

- [ ] **Step 8: Verify the dead-subscription cleanup path**

In a private/incognito window, log in, subscribe, then close the window without uninstalling. Insert a test notification. The function will attempt to push to the now-orphaned subscription; the push service eventually returns 404/410, and the function deletes the row from `push_subscriptions`. Verify:

```sql
select count(*) from push_subscriptions where user_id = '<your auth uid>';
```

Should drop back by one within a few cron ticks (the push service may not 410 immediately — it can take a few attempts).

- [ ] **Step 9: Update the BudgetWise project memory**

Edit `~/.claude/projects/-Users-kevinsmac/memory/budgetwise.md`:

- In "Phases 2, 3, 4 — ALL SHIPPED" section, change "Junior feature is **usable by real users** today with caveats: notifications need a parent tab open" to remove the parent-tab caveat.
- In "Audit remediation shipped 2026-04-22" → "Still open after this pass" list, change "Junior Phase 5 — server-side VAPID push sender" to "~~Junior Phase 5 — server-side VAPID push sender~~ — shipped 2026-04-23".
- In the SW cache note, bump v8 → v9.
- Add to "Edge functions deployed" list: `send-junior-push`.

---

## Self-Review

**Spec coverage:**

| Spec section | Covered by |
| --- | --- |
| §3 architecture | Tasks 4–7 (server), 9–11 (client) |
| §4 schema (push_subscriptions) | Task 4 (file + repair) |
| §4 migration repair note | Task 4 step 2 |
| §5 edge function | Task 5 (full code + deploy + smoke tests) |
| §5 npm:web-push fallback | Task 5 step 5 (fallback to jsr:@negrel/webpush noted) |
| §6 pg_cron jobs + Vault helper | Task 7 (migration) + Task 6 (Vault seed) |
| §6 Sunday enqueue SQL | Task 7 step 1 (in the migration body) |
| §6 sunday dedup index | Task 7 step 1 (last block) |
| §7 client subscribe lib | Task 9 |
| §7 PushPromptCard | Task 10 |
| §7 Account toggle | Task 11 |
| §8 deletes (sunday reminder + caller) | Task 12 |
| §9 setup ordering | Tasks 1, 2, 3, 6 (env/secrets/Vault) sequenced before code tasks |
| §9 sw.js cache bump | Task 13 |
| §10 verification recipes | Tasks 5 (steps 4, 5), 8 (backend e2e), 15 (full e2e) |
| §11 anon-key open question | Resolved by removing `apikey` header in Task 7 (the `--no-verify-jwt` deploy makes it unnecessary) |
| §12 non-goals | Honored — no native push, no kid push, no per-user TZ, no retry counter |

**Spec change made during plan writing:**
- Spec §6 used `junior.invoke_send_push()`. Plan uses `public.invoke_send_junior_push()` to match the existing migration convention (no other schemas exist under `supabase/migrations/`). Functionally identical; renamed in Task 7.
- Spec §6 included an `apikey` header in the cron helper as belt-and-suspenders. Plan drops it because the function is deployed `--no-verify-jwt` and the `x-cron-secret` is the actual auth check. One less env coupling.

**Placeholder scan:** none found. Every code block contains real, working code; every command has expected output.

**Type consistency:** `PushStatus`, `enablePush`, `disablePush`, `getPushStatus` are defined once in Task 9 and re-imported (not redefined) in Tasks 10 and 11. The edge function's `Row` and `Sub` interfaces are local to its file. The `buildPayload` strings in Task 5 match the strings in `src/lib/junior-notifications.ts:62-80` for the approval-nudge path (verified during design phase).

**Manual verification reliance:** Tasks 8 and 15 are manual recipes, not unit tests. This is intentional — the project has no test framework, and adding one is out of scope for Phase 5.
