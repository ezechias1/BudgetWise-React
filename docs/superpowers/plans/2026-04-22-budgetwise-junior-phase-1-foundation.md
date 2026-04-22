# BudgetWise Junior — Phase 1: Foundation (Walking Skeleton)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the end-to-end Junior stack works. Parent adds a child with a PIN, child logs in with that PIN, child lands on a kid-themed placeholder home page showing their own name. Nothing else. This is the walking skeleton — no ledger, no chores, no missions. When this phase is green, we know auth + routing + RLS are correct and can build the rest of Junior on top.

**Architecture:** One React codebase, two UI surfaces gated by role. Parent UI stays at `/dashboard/*`. Kid UI lives at `/junior/*` with its own layout. A new `AuthRoleGate` component checks whether the authenticated user is a child (via `family_members.auth_user_id` lookup) and redirects accordingly. Kids are real Supabase users with auto-generated internal emails and PIN-derived passwords, created server-side via an Edge Function.

**Tech Stack:** React 18 + TypeScript + Vite + react-router-dom v6 + Supabase (PostgreSQL + Auth + Edge Functions/Deno). No new deps for Phase 1.

**Design spec:** `docs/superpowers/specs/2026-04-22-budgetwise-junior-design.md`

**Repo:** `~/Desktop/BudgetWise-React/` (single working copy; commits go to `main`). If you want to isolate this work, create a git branch `junior-phase-1` before Task 1 and commit into it.

---

## Pre-flight checks (one-time, before Task 1)

- [ ] **Step P1: Verify Supabase CLI is installed and can reach the project.**

```bash
supabase --version
# Expect: v1.x.x or similar
supabase link --project-ref trkdlwukjyupvvcyzebf
# May prompt for access token — use sbp_c98609e9b0382a7ff1a88b079661c7dde3818dfb
```

- [ ] **Step P2: Confirm you can run the dev server and log in as the parent account.**

```bash
cd ~/Desktop/BudgetWise-React
npm run dev
```

Open `http://localhost:5173/`, log in as `ezechiasmulamba@gmail.com` / `ezechias10`. Confirm the dashboard loads. Leave it running in another terminal tab — most tasks will use it.

- [ ] **Step P3: Confirm `typecheck` is clean before starting.**

```bash
npm run typecheck
```

Expected: no errors. If there are errors, stop and fix them first — you shouldn't start feature work on a red baseline.

---

## Task 1: Database migration — Junior v1 schema

**Files:**
- Create: `supabase/migrations/20260422000000_junior_phase1_schema.sql`

Creates all new tables, adds required columns to existing `family_members` and `family_chores`, and installs RLS policies. One migration, one commit, so it's easy to roll back.

- [ ] **Step 1.1: Create the migration file.**

```bash
mkdir -p supabase/migrations
```

File: `supabase/migrations/20260422000000_junior_phase1_schema.sql`

```sql
-- BudgetWise Junior — Phase 1 schema
-- Adds child-account fields to family_members, audit cols to family_chores,
-- and creates kid_ledger / kid_missions / kid_mission_progress /
-- kid_mission_rewards / kid_streaks / kid_notifications / kid_devices.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. family_members: add child-login + age + jar split
-- ─────────────────────────────────────────────────────────────────────────
alter table family_members
  add column if not exists auth_user_id uuid references auth.users (id) on delete set null,
  add column if not exists pin_hash text,
  add column if not exists date_of_birth date,
  add column if not exists jar_split jsonb not null default '{"save":50,"spend":30,"give":20}'::jsonb;

create unique index if not exists family_members_auth_user_id_idx
  on family_members (auth_user_id)
  where auth_user_id is not null;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. family_chores: approval audit trail
-- ─────────────────────────────────────────────────────────────────────────
alter table family_chores
  add column if not exists approved_at timestamptz,
  add column if not exists rejected_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. kid_ledger — the IOU source of truth
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists kid_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  member_id uuid not null references family_members (id) on delete cascade,
  amount_cents integer not null check (amount_cents >= 0),
  source_type text not null check (source_type in ('chore','lesson','allowance','adjustment')),
  source_id uuid,
  status text not null default 'owed' check (status in ('owed','paid','void')),
  split jsonb,
  notes text,
  earned_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists kid_ledger_member_id_idx on kid_ledger (member_id);
create index if not exists kid_ledger_user_id_idx on kid_ledger (user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. kid_missions — seeded static content (editable via seed script only)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists kid_missions (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  unit text not null,
  title text not null,
  age_min integer not null default 10,
  age_max integer not null default 13,
  body jsonb not null,
  ord integer not null default 0,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 5. kid_mission_progress — per-kid state
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists kid_mission_progress (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references family_members (id) on delete cascade,
  mission_id uuid not null references kid_missions (id) on delete cascade,
  status text not null default 'available' check (status in ('locked','available','completed')),
  completed_at timestamptz,
  quiz_score integer,
  reward_amount_cents integer,
  unique (member_id, mission_id)
);

-- ─────────────────────────────────────────────────────────────────────────
-- 6. kid_mission_rewards — parent-configured reward per mission
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists kid_mission_rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mission_id uuid not null references kid_missions (id) on delete cascade,
  reward_amount_cents integer not null default 0,
  unique (user_id, mission_id)
);

-- ─────────────────────────────────────────────────────────────────────────
-- 7. kid_streaks — daily streak per member
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists kid_streaks (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null unique references family_members (id) on delete cascade,
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  last_active_date date
);

-- ─────────────────────────────────────────────────────────────────────────
-- 8. kid_notifications — outgoing notification queue
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists kid_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('approval_nudge','daily_digest','sunday_reminder')),
  payload jsonb not null default '{}'::jsonb,
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  status text not null default 'pending' check (status in ('pending','sent','cancelled'))
);

-- ─────────────────────────────────────────────────────────────────────────
-- 9. kid_devices — multi-kid-per-device lock screen support
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists kid_devices (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  member_id uuid not null references family_members (id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  unique (device_id, member_id)
);

-- ─────────────────────────────────────────────────────────────────────────
-- 10. Row-Level Security
-- ─────────────────────────────────────────────────────────────────────────
alter table kid_ledger enable row level security;
alter table kid_missions enable row level security;
alter table kid_mission_progress enable row level security;
alter table kid_mission_rewards enable row level security;
alter table kid_streaks enable row level security;
alter table kid_notifications enable row level security;
alter table kid_devices enable row level security;

-- kid_missions is public read-only content for any authenticated user
create policy "authenticated can read missions"
  on kid_missions for select to authenticated using (true);

-- kid_ledger: parent can read/write own rows; child can read rows scoped to their member row
create policy "parent manages own ledger"
  on kid_ledger for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "child reads own ledger"
  on kid_ledger for select to authenticated
  using (
    member_id in (
      select id from family_members where auth_user_id = auth.uid()
    )
  );

-- kid_mission_progress: parent manages all their children; child manages own
create policy "parent manages own children progress"
  on kid_mission_progress for all to authenticated
  using (
    member_id in (
      select id from family_members where user_id = auth.uid()
    )
  )
  with check (
    member_id in (
      select id from family_members where user_id = auth.uid()
    )
  );

create policy "child manages own progress"
  on kid_mission_progress for all to authenticated
  using (
    member_id in (
      select id from family_members where auth_user_id = auth.uid()
    )
  )
  with check (
    member_id in (
      select id from family_members where auth_user_id = auth.uid()
    )
  );

-- kid_mission_rewards: parent-only (child never writes reward amounts)
create policy "parent manages rewards"
  on kid_mission_rewards for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "child reads rewards for their parent"
  on kid_mission_rewards for select to authenticated
  using (
    user_id in (
      select user_id from family_members where auth_user_id = auth.uid()
    )
  );

-- kid_streaks: child reads/writes own; parent reads children's
create policy "child manages own streak"
  on kid_streaks for all to authenticated
  using (
    member_id in (
      select id from family_members where auth_user_id = auth.uid()
    )
  )
  with check (
    member_id in (
      select id from family_members where auth_user_id = auth.uid()
    )
  );

create policy "parent reads children streaks"
  on kid_streaks for select to authenticated
  using (
    member_id in (
      select id from family_members where user_id = auth.uid()
    )
  );

-- kid_notifications: parent-only
create policy "parent manages own notifications"
  on kid_notifications for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- kid_devices: parent manages for their children; child can upsert own row
create policy "parent manages devices for children"
  on kid_devices for all to authenticated
  using (
    member_id in (
      select id from family_members where user_id = auth.uid()
    )
  )
  with check (
    member_id in (
      select id from family_members where user_id = auth.uid()
    )
  );

create policy "child upserts own device row"
  on kid_devices for all to authenticated
  using (
    member_id in (
      select id from family_members where auth_user_id = auth.uid()
    )
  )
  with check (
    member_id in (
      select id from family_members where auth_user_id = auth.uid()
    )
  );

-- family_members: child can read their own row (needed for useKidProfile hook)
-- Parent policies on family_members already exist from prior migrations; this is additive.
drop policy if exists "child reads own member row" on family_members;
create policy "child reads own member row"
  on family_members for select to authenticated
  using (auth_user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────
-- 11. Seed one mission so Phase 2 has something to point at
-- ─────────────────────────────────────────────────────────────────────────
insert into kid_missions (slug, unit, title, ord, body) values (
  'what-is-saving',
  'Saving',
  'What does it mean to save?',
  1,
  '{
    "steps": [
      {"type":"hook","title":"Zoë'\''s R100","body":"Zoë got R100 from her gran. Watch what happens when she spends it all on sweets vs splits it into jars."},
      {"type":"concept","title":"A jar that waits grows","body":"A jar that waits grows. A jar that rushes empties."},
      {"type":"quiz","question":"Which jar gets bigger over time?","options":["The Save jar","The Spend jar","The Give jar"],"answer":0},
      {"type":"tie_in","body":"If you saved half of what you earn this week, your goal would be closer."},
      {"type":"done","body":"Mission done! Your first lesson is complete."}
    ]
  }'::jsonb
) on conflict (slug) do nothing;
```

- [ ] **Step 1.2: Apply the migration to the linked Supabase project.**

```bash
supabase db push
```

Expected: `Applying migration 20260422000000_junior_phase1_schema.sql...` then `Finished supabase db push.` No errors.

- [ ] **Step 1.3: Verify the schema in Supabase Dashboard.**

Open https://supabase.com/dashboard/project/trkdlwukjyupvvcyzebf/editor and confirm the following tables exist with Row Security enabled:
- `kid_ledger`, `kid_missions`, `kid_mission_progress`, `kid_mission_rewards`, `kid_streaks`, `kid_notifications`, `kid_devices`

Click `kid_missions` — it must contain exactly one row with `slug = 'what-is-saving'`.

Click `family_members` → Columns. Confirm `auth_user_id`, `pin_hash`, `date_of_birth`, `jar_split` are present.

- [ ] **Step 1.4: Commit.**

```bash
git add supabase/migrations/20260422000000_junior_phase1_schema.sql
git commit -m "feat(junior): add Phase 1 schema — kid ledger, missions, progress, RLS"
```

---

## Task 2: Edge Function `create-kid-user`

**Files:**
- Create: `supabase/functions/create-kid-user/index.ts`

Server-side endpoint the parent app calls when adding a child. It generates an internal Supabase auth user for the kid, hashes the PIN, and writes `family_members.auth_user_id` + `pin_hash`. The client never sees the service role key.

- [ ] **Step 2.1: Create the function file.**

```bash
mkdir -p supabase/functions/create-kid-user
```

File: `supabase/functions/create-kid-user/index.ts`

```ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hash as bcryptHash } from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function derivePassword(pin: string, memberId: string): string {
  // Supabase requires >= 6 chars. Combine PIN with a slice of the member UUID
  // so two kids with the same PIN don't collide at auth provider level.
  const suffix = memberId.replace(/-/g, "").slice(0, 8);
  return `kid_${pin}_${suffix}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "POST only" });
  }

  try {
    // Verify caller is an authenticated parent via their JWT
    const authHeader = req.headers.get("Authorization") || "";
    const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: parent } } = await anonClient.auth.getUser();
    if (!parent) return json(401, { error: "Not signed in" });

    const body = await req.json();
    const {
      member_id,
      name,
      pin,
      color,
      age,
      date_of_birth,
    } = body as {
      member_id?: string;
      name?: string;
      pin?: string;
      color?: string;
      age?: number | null;
      date_of_birth?: string | null;
    };

    if (!name || !pin) {
      return json(400, { error: "name and pin are required" });
    }
    if (!/^\d{4}$/.test(pin)) {
      return json(400, { error: "pin must be exactly 4 digits" });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Either create a new family_members row or update the one provided
    let memberRow: { id: string } | null = null;

    if (member_id) {
      const { data, error } = await admin
        .from("family_members")
        .select("id, user_id")
        .eq("id", member_id)
        .eq("user_id", parent.id)
        .maybeSingle();
      if (error) return json(500, { error: error.message });
      if (!data) return json(404, { error: "Member not found or not owned by caller" });
      memberRow = { id: data.id };
    } else {
      const { data, error } = await admin
        .from("family_members")
        .insert({
          user_id: parent.id,
          name,
          role: "child",
          color: color || "#8b5cf6",
          age: age ?? null,
          allowance: 0,
          spent: 0,
          earned: 0,
        })
        .select("id")
        .single();
      if (error) return json(500, { error: error.message });
      memberRow = { id: data!.id };
    }

    const internalEmail = `kid-${memberRow.id}@budgetwise.app`;
    const password = derivePassword(pin, memberRow.id);
    const pinHash = await bcryptHash(pin);

    // Create the child's Supabase auth user
    const { data: userData, error: userErr } = await admin.auth.admin.createUser({
      email: internalEmail,
      password,
      email_confirm: true,
      user_metadata: { kind: "child", parent_id: parent.id, member_id: memberRow.id },
    });
    if (userErr) return json(500, { error: userErr.message });

    // Wire the child's auth_user_id back onto the family_members row
    const { error: updErr } = await admin
      .from("family_members")
      .update({
        auth_user_id: userData.user!.id,
        pin_hash: pinHash,
        role: "child",
        date_of_birth: date_of_birth || null,
      })
      .eq("id", memberRow.id);
    if (updErr) return json(500, { error: updErr.message });

    return json(200, {
      member_id: memberRow.id,
      child_email: internalEmail,
    });
  } catch (err) {
    return json(500, { error: (err as Error).message });
  }
});
```

- [ ] **Step 2.2: Deploy the function.**

```bash
supabase functions deploy create-kid-user --project-ref trkdlwukjyupvvcyzebf --no-verify-jwt
```

`--no-verify-jwt` is required because we verify the JWT manually inside the function (the gateway's default verification can block Deno edge calls in some setups). Confirm output ends with `Deployed Function create-kid-user`.

- [ ] **Step 2.3: Smoke-test the function from the running dev server.**

In Chrome DevTools console on your logged-in parent dashboard, paste:

```js
const { data: { session } } = await window._supabase?.auth.getSession() ?? { data: { session: null } };
// Fallback: if _supabase isn't exposed, grab from localStorage
const access = session?.access_token || JSON.parse(Object.entries(localStorage).find(([k]) => k.includes('auth-token'))[1]).access_token;
const resp = await fetch(
  'https://trkdlwukjyupvvcyzebf.supabase.co/functions/v1/create-kid-user',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${access}`,
    },
    body: JSON.stringify({ name: 'TestKid', pin: '1234', age: 11 }),
  }
);
console.log(resp.status, await resp.json());
```

Expected: `200 { member_id: '...', child_email: 'kid-<uuid>@budgetwise.app' }`.

Then open Supabase → Authentication → Users. A new user with email `kid-...@budgetwise.app` must exist.

Open `family_members` table. The TestKid row must have `auth_user_id` filled and `pin_hash` starting with `$2a$` or `$2b$`.

- [ ] **Step 2.4: Clean up the test data.**

Back in DevTools console or the SQL editor, delete the test kid so it doesn't pollute further tasks:

```sql
-- SQL editor:
delete from family_members where name = 'TestKid';
-- Then Supabase → Authentication → Users, find kid-<uuid>@budgetwise.app, Delete user.
```

- [ ] **Step 2.5: Commit.**

```bash
git add supabase/functions/create-kid-user/index.ts
git commit -m "feat(junior): add create-kid-user edge function"
```

---

## Task 3: `useKidProfile` hook + access helpers

**Files:**
- Modify: `src/lib/access.ts`
- Create: `src/hooks/useKidProfile.ts`

A hook that tells the UI whether the current user is a parent or a child. Every Junior route and the `AuthRoleGate` depend on it.

- [ ] **Step 3.1: Add helpers to `src/lib/access.ts`.**

Append to `src/lib/access.ts`:

```ts
/**
 * A "kid user" is an authenticated Supabase user whose auth_user_id matches
 * a family_members row. The helper is async because we have to ask the DB —
 * you can't tell from the JWT alone (we could put it in user_metadata but
 * metadata is user-editable and shouldn't be trusted for routing).
 *
 * Prefer the useKidProfile hook in components; this raw helper is for places
 * the hook can't reach (e.g. one-off scripts).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface KidMemberRow {
  id: string;
  user_id: string;
  name: string;
  color: string;
  age: number | null;
  date_of_birth: string | null;
  allowance: number;
  earned: number;
  spent: number;
  jar_split: { save: number; spend: number; give: number };
  role: string;
}

export async function fetchKidMemberForUser(
  client: SupabaseClient,
  userId: string,
): Promise<KidMemberRow | null> {
  const { data, error } = await client
    .from('family_members')
    .select('id, user_id, name, color, age, date_of_birth, allowance, earned, spent, jar_split, role')
    .eq('auth_user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as KidMemberRow) ?? null;
}
```

- [ ] **Step 3.2: Create the hook file.**

File: `src/hooks/useKidProfile.ts`

```ts
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchKidMemberForUser, type KidMemberRow } from '@/lib/access';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Reads the current user's family_members row where auth_user_id = auth.uid().
 * If a row exists, the user is a kid. Otherwise they're a parent (or no role
 * yet).
 *
 * loading: true while we fetch. When loading is true, callers must render a
 * spinner — don't assume parent-ness during load.
 */
export function useKidProfile() {
  const { user, loading: authLoading } = useAuth();
  const [member, setMember] = useState<KidMemberRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setMember(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchKidMemberForUser(supabase, user.id)
      .then((row) => {
        if (!cancelled) {
          setMember(row);
          setError(null);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  return {
    member,
    isChild: !!member,
    loading: authLoading || loading,
    error,
  };
}
```

- [ ] **Step 3.3: Typecheck.**

```bash
npm run typecheck
```

Expected: no new errors. If TypeScript complains about `jar_split` or `role` types, double-check the column names match the migration from Task 1.

- [ ] **Step 3.4: Commit.**

```bash
git add src/lib/access.ts src/hooks/useKidProfile.ts
git commit -m "feat(junior): add useKidProfile hook + KidMemberRow type"
```

---

## Task 4: `<AuthRoleGate>` + junior routes wired into App.tsx

**Files:**
- Create: `src/components/AuthRoleGate.tsx`
- Modify: `src/App.tsx`

The gate component decides: if the signed-in user is a kid and they're on `/dashboard/*`, redirect to `/junior/home`. If they're a parent and they're on `/junior/*`, redirect to `/dashboard`. Either way, once the role is confirmed, render the matching subtree.

- [ ] **Step 4.1: Create the gate component.**

File: `src/components/AuthRoleGate.tsx`

```tsx
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useKidProfile } from '@/hooks/useKidProfile';
import { LoadingOverlay } from './LoadingOverlay';

/**
 * Gate a subtree behind: (a) a signed-in user and (b) a specific role.
 *
 * role = 'parent' — kids get bounced to /junior/home
 * role = 'child'  — parents get bounced to /dashboard
 */
export function AuthRoleGate({
  role,
  children,
}: {
  role: 'parent' | 'child';
  children: ReactNode;
}) {
  const { user, loading: authLoading } = useAuth();
  const { isChild, loading: kidLoading } = useKidProfile();
  const location = useLocation();

  if (authLoading || kidLoading) return <LoadingOverlay />;
  if (!user) return <Navigate to="/" replace state={{ from: location }} />;

  if (role === 'parent' && isChild) {
    return <Navigate to="/junior/home" replace />;
  }
  if (role === 'child' && !isChild) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}
```

- [ ] **Step 4.2: Wire junior routes into `App.tsx`.**

Modify `src/App.tsx`. Replace the existing `<Route path="/dashboard" ...>` block so the parent dashboard is wrapped in `AuthRoleGate role="parent"`, and add a sibling `<Route path="/junior/*">` block:

At the top of the file, add these imports alongside the existing ones:

```tsx
import { AuthRoleGate } from '@/components/AuthRoleGate';
```

Then add these lazy-loaded component imports next to the other `const ... = lazy(...)` lines:

```tsx
const JuniorHomePage = lazy(() => import('@/pages/junior/JuniorHomePage'));
const JuniorLoginPage = lazy(() => import('@/pages/junior/JuniorLoginPage'));
const JuniorLayout = lazy(() =>
  import('@/components/junior/JuniorLayout').then((m) => ({ default: m.JuniorLayout }))
);
```

Make exactly two surgical changes.

**Change A:** Only the `element=` prop of the outer `<Route path="/dashboard">` changes. Swap:

```tsx
              element={
                <ProtectedRoute>
                  <DashboardLayout />
                </ProtectedRoute>
              }
```

for:

```tsx
              element={
                <AuthRoleGate role="parent">
                  <DashboardLayout />
                </AuthRoleGate>
              }
```

Leave every child `<Route ...>` inside the dashboard block exactly as it currently is. Do not touch them.

**Change B:** Add the Junior routes immediately before the catch-all `<Route path="*" element={<Navigate to="/" replace />} />` at the bottom of `<Routes>`. Insert this block:

```tsx
            {/* Junior (kid-only) */}
            <Route path="/junior/login" element={<JuniorLoginPage />} />
            <Route
              path="/junior"
              element={
                <AuthRoleGate role="child">
                  <JuniorLayout />
                </AuthRoleGate>
              }
            >
              <Route path="home" element={<JuniorHomePage />} />
              <Route index element={<Navigate to="home" replace />} />
            </Route>
```

**Remove** the `ProtectedRoute` name from `App.tsx`'s import of `@/components/ProtectedRoute` (keep `AdminRoute`). Although `AdminRoute` internally uses the same auth-gate logic as `ProtectedRoute`, it's exported separately from the same file; App.tsx itself has no direct reference to `ProtectedRoute` after Change A, and `noUnusedLocals: true` in `tsconfig.json` will otherwise flag the import as an error.

```tsx
import { AdminRoute } from '@/components/ProtectedRoute';
```

- [ ] **Step 4.3: Typecheck.**

```bash
npm run typecheck
```

Expected: TS will complain that `JuniorHomePage`, `JuniorLoginPage`, and `JuniorLayout` don't exist yet. That's fine — we build them in Tasks 5–7 next. If any *other* type error shows, fix it before moving on.

- [ ] **Step 4.4: Commit (do not skip even though typecheck is red).**

```bash
git add src/components/AuthRoleGate.tsx src/App.tsx
git commit -m "feat(junior): add AuthRoleGate + wire junior routes (placeholder targets)"
```

The red typecheck is intentional — the next three tasks resolve it.

---

## Task 5: `<JuniorLayout>` + placeholder `/junior/home`

**Files:**
- Create: `src/components/junior/JuniorLayout.tsx`
- Create: `src/pages/junior/JuniorHomePage.tsx`
- Create: `src/styles-junior.css`
- Modify: `src/main.tsx` (import the new CSS)

Bottom-nav layout, no sidebar, bright colour. Just enough to prove the kid sees *their* page when signed in.

- [ ] **Step 5.1: Create the Junior CSS module.**

File: `src/styles-junior.css`

```css
/* ─── BudgetWise Junior — kid-first layout ─────────────────────────── */

.junior-shell {
  min-height: 100vh;
  background: linear-gradient(180deg, #fff7ed 0%, #fef3c7 100%);
  color: #1f2937;
  font-family: 'Inter', system-ui, sans-serif;
  padding-bottom: 84px; /* space for bottom nav */
}

.junior-shell.dark {
  background: linear-gradient(180deg, #1a1a2e 0%, #16213e 100%);
  color: #f9fafb;
}

.junior-main {
  max-width: 520px;
  margin: 0 auto;
  padding: 24px 20px 32px;
}

.junior-bottom-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: #ffffff;
  border-top: 1px solid #fde68a;
  padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
  display: flex;
  justify-content: space-around;
  z-index: 100;
}

.junior-bottom-nav button {
  background: none;
  border: 0;
  font: inherit;
  padding: 8px 12px;
  border-radius: 12px;
  color: #6b7280;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 0.78rem;
  gap: 2px;
}

.junior-bottom-nav button.active {
  color: #10b981;
  background: rgba(16, 185, 129, 0.1);
  font-weight: 600;
}

.junior-hero {
  background: #10b981;
  color: white;
  border-radius: 24px;
  padding: 28px 24px;
  box-shadow: 0 20px 40px -16px rgba(16, 185, 129, 0.5);
}

.junior-hero h1 {
  font-size: 1.8rem;
  font-weight: 700;
  margin: 0 0 8px;
}

.junior-hero p {
  margin: 0;
  opacity: 0.9;
  font-size: 1rem;
}

.junior-signout {
  margin-top: 24px;
  background: #fff;
  color: #dc2626;
  border: 1px solid #fecaca;
  border-radius: 12px;
  padding: 10px 16px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
```

- [ ] **Step 5.2: Import the CSS from `src/main.tsx`.**

Read `src/main.tsx` first to see its existing imports, then add a line alongside the other CSS imports:

```tsx
import '@/styles-junior.css';
```

- [ ] **Step 5.3: Create `JuniorLayout`.**

File: `src/components/junior/JuniorLayout.tsx`

```tsx
import { useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

export function JuniorLayout() {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  // Junior surface is light-only in Phase 1; force body class so vanilla-CSS
  // dark selectors elsewhere don't bleed in.
  useEffect(() => {
    document.body.classList.add('junior-active');
    return () => document.body.classList.remove('junior-active');
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigate('/', { replace: true });
  };

  return (
    <div className="junior-shell">
      <main className="junior-main">
        <Outlet />
        <button className="junior-signout" onClick={handleSignOut}>
          Sign out
        </button>
      </main>
      <nav className="junior-bottom-nav">
        <NavLink to="/junior/home" className={({ isActive }) => (isActive ? 'active' : '')}>
          <span>🏠</span>Home
        </NavLink>
        {/* More tabs added in Phase 2+ */}
      </nav>
    </div>
  );
}
```

- [ ] **Step 5.4: Create `JuniorHomePage`.**

File: `src/pages/junior/JuniorHomePage.tsx`

```tsx
import { useKidProfile } from '@/hooks/useKidProfile';

export default function JuniorHomePage() {
  const { member, loading } = useKidProfile();

  if (loading) return <p>Loading…</p>;
  if (!member) return <p>Something went wrong — no profile found.</p>;

  return (
    <section className="junior-hero">
      <h1>Welcome, {member.name}! 👋</h1>
      <p>
        Your money stuff is coming soon. Chores, missions, savings, and Save /
        Spend / Give jars will show up here next.
      </p>
    </section>
  );
}
```

- [ ] **Step 5.5: Typecheck.**

```bash
npm run typecheck
```

Expected: `JuniorLoginPage` still missing — that's Task 6. Everything else should compile.

- [ ] **Step 5.6: Commit.**

```bash
git add src/styles-junior.css src/main.tsx \
  src/components/junior/JuniorLayout.tsx \
  src/pages/junior/JuniorHomePage.tsx
git commit -m "feat(junior): add JuniorLayout shell + placeholder home page"
```

---

## Task 6: `/junior/login` PIN entry page

**Files:**
- Create: `src/pages/junior/JuniorLoginPage.tsx`
- Create: `src/lib/junior-auth.ts`

A form that takes a kid `member_id` (from the URL query string in Phase 1) and a 4-digit PIN, then signs the kid in with Supabase. The derivation has to match the Edge Function exactly.

- [ ] **Step 6.1: Create the auth helper.**

File: `src/lib/junior-auth.ts`

```ts
import { supabase } from '@/lib/supabase';

/**
 * Must match derivePassword in supabase/functions/create-kid-user/index.ts.
 * Any divergence here and the PIN login will silently fail.
 */
export function derivePassword(pin: string, memberId: string): string {
  const suffix = memberId.replace(/-/g, '').slice(0, 8);
  return `kid_${pin}_${suffix}`;
}

export function kidEmailForMember(memberId: string): string {
  return `kid-${memberId}@budgetwise.app`;
}

export async function signInAsKid(memberId: string, pin: string) {
  const email = kidEmailForMember(memberId);
  const password = derivePassword(pin, memberId);
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { error: error?.message ?? null };
}
```

- [ ] **Step 6.2: Create the login page.**

File: `src/pages/junior/JuniorLoginPage.tsx`

```tsx
import { useState, type FormEvent } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { signInAsKid } from '@/lib/junior-auth';

export default function JuniorLoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const memberId = params.get('as') || '';
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = /^\d{4}$/.test(pin) && memberId.length > 0 && !submitting;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const { error: err } = await signInAsKid(memberId, pin);
    if (err) {
      setError('Wrong PIN. Try again.');
      setPin('');
      setSubmitting(false);
      return;
    }
    navigate('/junior/home', { replace: true });
  };

  if (!memberId) {
    return (
      <div className="junior-shell">
        <main className="junior-main">
          <h1 style={{ color: '#dc2626' }}>Link missing</h1>
          <p>Ask your parent for your login link again.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="junior-shell">
      <main className="junior-main">
        <section className="junior-hero">
          <h1>🔐 Enter your PIN</h1>
          <p>Type the 4 numbers your parent gave you.</p>
        </section>

        <form onSubmit={handleSubmit} style={{ marginTop: 28 }}>
          <input
            type="tel"
            inputMode="numeric"
            autoFocus
            maxLength={4}
            pattern="\d{4}"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            aria-label="4-digit PIN"
            style={{
              width: '100%',
              fontSize: '2.5rem',
              letterSpacing: '0.8rem',
              textAlign: 'center',
              padding: '20px',
              border: '2px solid #fde68a',
              borderRadius: 16,
              background: '#fff',
            }}
          />
          {error && (
            <p style={{ color: '#dc2626', marginTop: 12, fontWeight: 600 }}>{error}</p>
          )}
          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              width: '100%',
              marginTop: 20,
              background: canSubmit ? '#10b981' : '#d1d5db',
              color: 'white',
              border: 0,
              padding: '16px',
              fontSize: '1.1rem',
              fontWeight: 700,
              borderRadius: 16,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            {submitting ? 'Checking…' : "Let's go"}
          </button>
        </form>
      </main>
    </div>
  );
}
```

- [ ] **Step 6.3: Typecheck.**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 6.4: Commit.**

```bash
git add src/lib/junior-auth.ts src/pages/junior/JuniorLoginPage.tsx
git commit -m "feat(junior): add PIN login page + password derivation"
```

---

## Task 7: Parent-side "Add Kid" modal wired into MembersPage

**Files:**
- Create: `src/components/AddKidModal.tsx`
- Modify: `src/pages/MembersPage.tsx`

Minimal Add Kid flow: name + PIN + age + colour → calls the Edge Function → shows the parent the login URL to share with their child.

- [ ] **Step 7.1: Create `AddKidModal`.**

File: `src/components/AddKidModal.tsx`

```tsx
import { useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';

const COLORS = ['#8b5cf6', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#ec4899'];

interface Props {
  onClose: () => void;
  onAdded: () => void;
}

export function AddKidModal({ onClose, onAdded }: Props) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [age, setAge] = useState<string>('');
  const [color, setColor] = useState(COLORS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);

  const canSubmit =
    name.trim().length > 0 && /^\d{4}$/.test(pin) && !submitting;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('Not signed in.');
        setSubmitting(false);
        return;
      }

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-kid-user`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            name: name.trim(),
            pin,
            color,
            age: age ? Number(age) : null,
          }),
        },
      );

      const payload = await resp.json();
      if (!resp.ok) {
        setError(payload.error || 'Failed to add kid.');
        setSubmitting(false);
        return;
      }

      const url = `${window.location.origin}/junior/login?as=${payload.member_id}`;
      setLoginUrl(url);
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loginUrl) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2>🎉 {name} is ready</h2>
          <p>Share this link with your child. They&apos;ll enter their PIN on that page.</p>
          <input
            readOnly
            value={loginUrl}
            onFocus={(e) => e.currentTarget.select()}
            style={{ width: '100%', padding: 10, fontFamily: 'monospace', fontSize: '0.85rem' }}
          />
          <p style={{ marginTop: 16 }}>
            <strong>PIN:</strong> <code style={{ fontSize: '1.2rem' }}>{pin}</code>
          </p>
          <button onClick={onClose} className="btn-primary" style={{ marginTop: 20 }}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add a kid</h2>
        <form onSubmit={handleSubmit}>
          <label>Name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>

          <label>4-digit PIN
            <input
              type="tel"
              inputMode="numeric"
              maxLength={4}
              pattern="\d{4}"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              required
            />
          </label>

          <label>Age (optional)
            <input
              type="number"
              min={4}
              max={18}
              value={age}
              onChange={(e) => setAge(e.target.value)}
            />
          </label>

          <label>Avatar colour
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              {COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setColor(c)}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: c,
                    border: color === c ? '3px solid #1f2937' : '2px solid transparent',
                    cursor: 'pointer',
                  }}
                  aria-label={`Pick colour ${c}`}
                />
              ))}
            </div>
          </label>

          {error && (
            <p style={{ color: '#dc2626', fontWeight: 600 }}>{error}</p>
          )}

          <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" disabled={!canSubmit} className="btn-primary">
              {submitting ? 'Adding…' : 'Add kid'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

*(The `.modal-backdrop` and `.modal` classes already exist in the project's shared CSS — see any other modal component like `ExpenseModal.tsx` for confirmation. If they don't exist, add minimal styles alongside this file.)*

- [ ] **Step 7.2: Add an "Add Kid" button to MembersPage.**

Read `src/pages/MembersPage.tsx` (the whole file — you need to see where the existing add-member button sits). Find the header area that contains the existing `setShowModal(true)` button and add a sibling button right after it.

Import the new modal at the top of the file:

```tsx
import { AddKidModal } from '@/components/AddKidModal';
```

Add a new piece of state near the other `useState` calls:

```tsx
const [showKidModal, setShowKidModal] = useState(false);
```

In the JSX, directly after the existing "Add member" button, add:

```tsx
<button
  type="button"
  onClick={() => setShowKidModal(true)}
  style={{ marginLeft: 12 }}
>
  Add kid (Junior) 🧒
</button>
```

At the same JSX level where the existing `{showModal && ...}` modal lives, add:

```tsx
{showKidModal && (
  <AddKidModal
    onClose={() => setShowKidModal(false)}
    onAdded={() => {
      load(); // reuse the existing reload function
      setShowKidModal(false);
    }}
  />
)}
```

- [ ] **Step 7.3: Typecheck.**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 7.4: Commit.**

```bash
git add src/components/AddKidModal.tsx src/pages/MembersPage.tsx
git commit -m "feat(junior): parent Add Kid modal with PIN + login URL share"
```

---

## Task 8: End-to-end smoke test (the whole walking skeleton)

**Files:**
- None — this task is manual verification.

Confirm every piece works together. If any step fails, stop and fix before committing Phase 1.

- [ ] **Step 8.1: Start dev server (if not already running).**

```bash
npm run dev
```

Visit `http://localhost:5173/` and sign in as the parent (`ezechiasmulamba@gmail.com` / `ezechias10`).

- [ ] **Step 8.2: Create a test kid.**

Navigate to **Family → Members**. Click **"Add kid (Junior) 🧒"**. Fill in:
- Name: `TestSarah`
- PIN: `4721`
- Age: `11`
- Any colour

Submit. A success modal should display the login URL and PIN `4721`. Copy the login URL.

- [ ] **Step 8.3: Verify DB state.**

In Supabase dashboard, open `family_members`. The `TestSarah` row must have:
- `role` = `'child'`
- `auth_user_id` = a UUID
- `pin_hash` = a string starting with `$2`

In Supabase → Authentication → Users, a user `kid-<uuid>@budgetwise.app` must exist.

- [ ] **Step 8.4: Sign out as parent, open the login URL.**

Click **Sign out** in the parent dashboard. Paste the login URL (e.g. `http://localhost:5173/junior/login?as=<member-id>`) into the address bar. The PIN screen must render with the yellow/green hero.

- [ ] **Step 8.5: Enter the wrong PIN first.**

Type `0000`, submit. The error **"Wrong PIN. Try again."** must show and the PIN field clear. No console errors.

- [ ] **Step 8.6: Enter the right PIN.**

Type `4721`, submit. The app must redirect to `/junior/home`. The page must render the green hero card with **"Welcome, TestSarah! 👋"** and a Sign out button.

- [ ] **Step 8.7: Attempt to hit a parent URL as the kid.**

In the address bar, try `http://localhost:5173/dashboard`. You must be bounced back to `/junior/home`. Same if you try `/dashboard/expenses`. No console errors.

- [ ] **Step 8.8: Verify RLS isolation.**

Open DevTools → Console while signed in as TestSarah:

```js
const { data, error } = await window._supabase?.from('expenses').select('*').limit(5);
console.log({ data, error });
```

(If `window._supabase` isn't exposed, skip — the routing check in Step 8.7 already demonstrates the gate works.)

Expected: `data` is `[]` or RLS denies — TestSarah should see zero `expenses` rows because they all belong to the parent.

- [ ] **Step 8.9: Sign out as kid, sign back in as parent.**

Click **Sign out** in the Junior UI. You should land on `/`. Sign in as the parent. Navigate back to Members — TestSarah should still be listed.

- [ ] **Step 8.10: Clean up the test kid.**

Either (a) leave TestSarah in place for Phase 2 testing, or (b) delete:
- Supabase SQL editor: `delete from family_members where name = 'TestSarah';`
- Supabase Authentication → Users: delete `kid-<uuid>@budgetwise.app`

- [ ] **Step 8.11: Final typecheck + commit the E2E validation note.**

```bash
npm run typecheck  # must be clean
git log --oneline -10  # sanity check the Phase 1 commits
```

- [ ] **Step 8.12: Push to origin.**

```bash
git push origin HEAD
```

If Vercel is set up, the React app auto-deploys. Visit `https://budget-wise-react.vercel.app/junior/login?as=<test-member-id>` to smoke-test in production. (Remember the Edge Function was deployed in Task 2.3 so it's already live.)

---

## Phase 1 — done criteria

All of these must be true before we call Phase 1 shipped:

- [ ] Migration `20260422000000_junior_phase1_schema.sql` applied to the live Supabase project. All 7 kid tables exist with RLS on.
- [ ] Edge Function `create-kid-user` deployed and responding 200 for a valid call.
- [ ] `useKidProfile` hook identifies the signed-in user as parent or child.
- [ ] `<AuthRoleGate>` correctly redirects parent ↔ kid across routes.
- [ ] Parent can add a kid with a PIN via MembersPage.
- [ ] Kid can sign in at `/junior/login?as=<member_id>` with their PIN and land on `/junior/home`.
- [ ] Kid cannot reach `/dashboard` — is bounced back to `/junior/home`.
- [ ] Kid cannot read rows from `expenses` (RLS-isolated).
- [ ] `npm run typecheck` is clean.

---

## What Phase 2 will build on top of this

(Not implemented in this plan — drafted here so you know what shape Phase 2 will take.)

- Finish parent approval flow in `ChoresPage` (wire `approved_at` / `rejected_at`)
- Add `useKidLedger` hook — reads `kid_ledger`, returns owed total per kid
- Add `JuniorDashboardPage` at `/dashboard/junior` (per-child cards with owed + settle-up button)
- Add "Mark as paid" flow — writes ledger rows to `status = 'paid'` with jar split
- Add `/junior/chores` — kid ticks chores done → writes `pending_approval = true`
- Update `/junior/home` to show real 3-hero-numbers: owed, streak, goal

Expect Phase 2 to be about the same size as Phase 1 (~8 tasks, ~1 week).
