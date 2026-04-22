# BudgetWise Junior — Design Spec

- **Date:** 2026-04-22
- **Status:** Approved (brainstorm complete, ready to plan)
- **Target:** BudgetWise-React codebase (`~/Desktop/BudgetWise-React/`)
- **Mission:** Teach kids (ages 10–13) the importance of budgeting by turning Family mode into a parent-supervised, kid-driven earn/save/spend/learn loop.

## 1. Product Concept

BudgetWise Junior lives inside the existing Family mode. A parent creates a child profile, assigns chores with rand rewards, and approves completed ones. The child gets their own login (4-digit PIN). When they log in, they see a kid-first UI with a big "parents owe you" number, three jars (Save / Spend / Give), a chore list, a savings goal, and a 2–3 minute Daily Mission tied to what they just did. Earning happens through chores and finished lessons; spending is logged against the Spend jar; saving fills their goal; lessons teach budgeting concepts. Parents see an oversight dashboard on the same family data and settle up when they pay the kid in cash or EFT.

## 2. Architecture

**One codebase, two surfaces, one Supabase project, one Pro subscription.**

### Parent surface (existing BudgetWise dashboard)
- `MembersPage` — add/edit child profile, generate PIN credential
- `ChoresPage` — assign chores; approve/reject pending ones (finishes existing TODO)
- `AllowancesPage` — set weekly/monthly allowances per child
- `FamilyGoalsPage` — view/contribute to each kid's goals
- **New:** `JuniorDashboardPage` — one card per child with owed / streak / goal, "Mark paid" flow, mission reward config

### Kid surface (new, kid-first UI, separate routes under `/junior/*`)
- Kid-themed layout: no sidebar, big bottom nav, bright colours, friendly type, no data-dense admin views
- `/junior/home` — 3 hero numbers, today's focus card, quick-access chores + mission
- `/junior/chores` — kid's chore list, tap to mark done → parent approval
- `/junior/goal` — one big savings goal with progress visualisation
- `/junior/missions` — list of available/completed/locked missions
- `/junior/mission/:id` — mission player (hook → concept → quiz → tie-in → reward)
- `/junior/jars` — jar split screen, weekly check-in prompt

### Switching layer
- On auth, a new `<AuthRoleGate>` component looks up whether the authenticated user is a `family_members` row with `role = 'child'`.
- Kid → redirect to `/junior/home`. Parent → regular BudgetWise.
- Kids cannot reach parent routes. Parent can toggle "preview as kid" — deferred to v1.1.
- Multi-kid device: lock screen lists all kid avatars registered on the device; tap avatar + enter PIN.

### Shared substrate
- Same Supabase project, same tables. Kid actions scoped via `member_id`.
- No new auth system. Child logins are regular Supabase users with auto-generated internal emails and RLS scoped to their `family_members` row.

## 3. Daily Loop (the retention engine)

Target: under 3 minutes per day, feels like a game, actually teaches.

**Kid opens app:**
1. Home greets with three numbers:
   - 🐷 Parents owe you: **R85** (the ledger — the point of the whole product)
   - 🔥 Streak: 4 days
   - 🎯 R120 to go for your savings goal
2. "What's new" card — most recent unresolved thing (new chore, unlocked mission, parent-just-paid notification).
3. Chore list — tap done → `pending_approval`, kid sees "Waiting for Mom to approve."
4. Daily Mission — 2–3 min lesson tied to their own recent activity, parent-set reward, one per day.
5. Weekly jar split check — "You chose 50/30/20. Still happy?" Forces conscious allocation.

**Parent settles up:**
- Taps "Mark R85 as paid" on their Junior dashboard.
- Kid gets push: "💸 Mom paid you R85 — R42 Save, R25 Spend, R18 Give."
- Jars + goal progress update.

**Weekly Sunday ritual:**
- Kid sees "This week you earned R85, did 4 chores, finished 5 missions."
- Parent gets a tiny summary and a settle-up nudge.

**Design choice that matters:** approval happens *before* ledger credit. Parent is in the loop every time — which is the parent value prop.

## 4. IOU Ledger Model

**Key decision:** kid's "balance" is not virtual money — it's a real debt owed by the parent, tracked in `kid_ledger`.

- Every completed chore (after parent approval) → ledger row with `status = 'owed'`.
- Every completed lesson → ledger row with `status = 'owed'` using the parent's per-mission reward amount.
- Parent sees "You owe Sarah R85" on Junior dashboard and in notifications.
- Parent taps **Mark as paid** → ledger rows flip to `status = 'paid'`, `paid_at` timestamp, payment method (cash / EFT / other).
- Optional kid bank account: parent can add kid's account details on the profile; if EFT is marked, we log which account. We do **not** move money through BudgetWise — we are not a payments business.
- Jar split is **allocation intent**: kid pre-sets "50% Save / 30% Spend / 20% Give". When parent marks paid, the settled amount distributes across jars per the split. Kid learns the habit at point of payment, not point of earning.

## 5. Multi-Child Support

- `family_members` is a list, no cap. Parent adds kids from `MembersPage`.
- Every kid-scoped row (ledger, chores, mission progress, streaks, jars, goal) is keyed by `member_id`. No data bleed between siblings.
- Parent Junior dashboard: one card per kid side by side, tap to drill in.
- Kid side: if two kid accounts exist on a device, lock screen shows both avatars — no log-out/log-in needed between siblings.

## 6. Notifications (Parent)

Three tiers, toggleable in parent Settings. Default-on: approval nudge + Sunday settle-up reminder. Default-off: daily 6 PM digest (opt-in only).

1. **Approval nudge** (immediate, batched) — "Sarah has 3 things waiting for approval." Fires when chores/missions are pending. Batched within ~5 min window.
2. **Daily digest** (6 PM, configurable) — "You owe Sarah R85, Tom R40." Only fires when debt > 0 to any kid. **Opt-in.**
3. **Sunday settle-up reminder** — "New week. Last week you owed the kids R125 — settle up?" Max one fire per Sunday.

**Delivery:** Web Push via existing service worker (same code path as BudgetWise automations). Upgrades to native push when Capacitor wraps the app.

**Anti-nag rules:** if parent marks paid → notifications pause. If total owed unchanged for 3+ days → stop resending daily digest.

## 7. Child Login (PIN Model)

- Parent creates child profile, sets 4-digit PIN.
- New Supabase Edge Function `create-kid-user` generates internal email (e.g. `sarah.mulamba+kid-<uuid>@budgetwise.app`), auto-password, writes `family_members.auth_user_id` + `pin_hash`.
- Kid sees only the PIN. Kid never types an email.
- Parent can reset PIN anytime in 2 taps.
- Kid's Supabase user has RLS scoped to their own member row — cannot see parent's expenses, savings, linked accounts, or siblings.

Compliance-friendly: parent technically owns the under-13 Supabase user. Aligns with how Greenlight / GoHenry / Step handle under-13 accounts.

## 8. Curriculum (Missions)

**Constraints:** 3-min max; feels like real teaching; parent-set reward; discrete done/not-done.

### Structure
- **Units** — Earning, Saving, Spending, Giving, Big Ideas
- **Missions** — 5–8 per unit
- **Steps** — 3–5 screens per mission: Hook → Concept → Quiz (1–3 Qs) → Tie-in to their own ledger numbers → Completion + reward reveal

### What gets taught (age 10–13)
- **Earning:** chores, effort-for-money, opportunity cost
- **Saving:** why wait, compound interest (light), goal-based, emergency money
- **Spending:** needs vs wants, unit price, "is it worth it" test, buyer's remorse
- **Giving:** impact, choosing a cause, R1 can matter
- **Big Ideas:** how banks work, what interest/debt is, what a job is, what taxes are (gentle)

### Launch content
**12 missions across 4 units**, sourced from existing free financial-literacy curricula (FSCA, Khan Academy Kids, MyMoney.gov) and adapted. Gives us pedagogical credibility and a Play Store legitimacy story.

Missions are JSON in `kid_missions` — we can add more without code deploys.

## 9. Monetisation

**$4.99/month Pro (bundled, existing tier) + freemium gate.**

### Free tier (no Pro)
- 1 child
- 3 chores max
- 5 missions unlocked
- No notifications
- Enough to feel the product, not enough to form a habit

### Pro unlocks
- Unlimited children
- Unlimited chores
- All missions
- All notifications (approval + daily digest + Sunday reminder)

### Rationale
- Zero new billing code — `useUserSettings.is_pro`, PayPal flow, trial reminders already exist.
- Junior becomes the "reason to finally pay" for existing free users with kids.
- Marketing story sharpens: *"The budget app for you AND your kids — $4.99/month."*
- Per-kid pricing was rejected — makes sense when moving real money (the bank pays); we don't.

## 10. Data Model

### Modified tables

**`family_members`**
- `+ auth_user_id uuid` — references `auth.users`
- `+ pin_hash text` — bcrypt hash of 4-digit PIN
- `+ date_of_birth date` — optional, gates age-appropriate missions
- `+ jar_split jsonb` — e.g. `{"save": 50, "spend": 30, "give": 20}`
- `role` gains value `'child'`

**`family_chores`**
- `+ approved_at timestamptz`, `+ rejected_at timestamptz` — audit trail
- Start using existing `pending_approval`

### New tables

**`kid_ledger`** — IOU source of truth
`id, member_id, user_id (parent), amount_cents, source_type ('chore'|'lesson'|'allowance'|'adjustment'), source_id, status ('owed'|'paid'|'void'), earned_at, paid_at, split jsonb, notes`

**`kid_missions`** — seeded static content
`id, unit, slug, title, age_min, age_max, body jsonb, order`

**`kid_mission_progress`** — per-kid state
`id, member_id, mission_id, status ('locked'|'available'|'completed'), completed_at, quiz_score, reward_amount_cents`

**`kid_mission_rewards`** — parent config per mission
`id, user_id, mission_id, reward_amount_cents` (NULL = R0)

**`kid_streaks`**
`id, member_id, current_streak, longest_streak, last_active_date`

**`kid_notifications`** — queue for digest / Sunday
`id, user_id, kind, payload jsonb, scheduled_for, sent_at, status`

**`kid_devices`** — for multi-kid lock screen
`id, device_id, member_id, last_seen_at`

### RLS

- Child user can only read/write rows where `member_id = (their auth_user_id → family_members.id)`.
- Child cannot read `expenses`, `savings_goals`, `linked_accounts`, `user_settings` (parent's personal finances).
- Child can read `kid_missions` (public content).
- Child can read own `kid_ledger` rows; cannot insert or mark paid.

### Seed data

- `kid_missions` gets 12 rows at first Supabase migration, sourced from FSCA / Khan adaptations.

## 11. MVP Scope (v1)

### In scope — must-ship

**Parent side**
- Add/edit child profile with PIN
- Assign chores with rand value (finish existing `ChoresPage`)
- Approve/reject pending chores (finish existing TODO)
- Set reward per mission
- `JuniorDashboardPage` with per-child cards, "Mark paid" flow
- Notifications on by default: approval nudge + Sunday settle-up reminder

**Kid side**
- PIN login + multi-kid lock screen
- Kid home (3 hero numbers + focus card)
- Kid chore list (done → pending approval)
- 12 seeded missions across 4 units
- Daily mission player (5-step flow)
- Jars screen (split % adjuster, weekly check-in)
- One active savings goal per kid at a time (kid completes one, can start another — no concurrent goals in v1)

**Shared**
- Full RLS isolation: kid vs parent vs sibling vs other families
- `kid_ledger` with owed/paid states
- Freemium gates (1 child + 3 chores + 5 missions free)

### Out of v1 — documented, not built
- Daily 6 PM digest
- Kid bank account linking (even as reference)
- Giving jar → real charity donation
- Mission tree visualisation (launch: flat list)
- Cosmetic rewards / avatar items / badges
- Parent "preview as kid" mode
- CSV history export
- Multi-parent households
- Custom parent-authored missions

### Phases
- **v1 (3–4 weeks):** everything in-scope above. Ship to Vercel + Play Store, test with 3–5 SA families.
- **v1.1 (1 week):** cosmetic rewards, mission tree, daily digest — added *after* first-week retention data.
- **v2 (later):** kid bank linking, giving-jar charity integration, custom missions.

### Effort estimate (rough)
- Kid-facing UI + PIN auth: **~6 days**
- Finishing parent approval flow + `JuniorDashboardPage`: **~3 days**
- Ledger + settle-up + jar split: **~3 days**
- Seeding + serving 12 missions + mission player: **~4 days**
- Notifications wiring + Sunday reminder: **~2 days**
- RLS, freemium gates, testing across all 3 perspectives: **~3 days**
- **Total: ~3 weeks** of focused work.

## 12. Open Questions / Risks

- **PWA push reliability on iOS** — we rely on existing BudgetWise web push, which works on Android but is spotty on iOS Safari. Capacitor wrap fixes this. For v1 Android-first is acceptable.
- **Supabase Edge Function for kid user creation** needs `SUPABASE_SERVICE_ROLE_KEY` — existing project already has this configured.
- **Mission content licensing** — FSCA and Khan Kids materials are free to adapt but confirm attribution requirements before publishing.
- **Trial / freemium gating on Junior features** — we should not strand a paying Pro user mid-launch when they downgrade. Define "what happens when Pro lapses" for kid data: assume read-only, no new ledger writes, nudge to reactivate.
