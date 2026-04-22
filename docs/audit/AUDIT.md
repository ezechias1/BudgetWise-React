# BudgetWise-React — Consolidated Whole-App Audit

**Date:** 2026-04-22
**Scope:** Full React app + Supabase backend + Junior feature (Phases 1–4)
**Methodology:** Synthesized three 2026-04-22 audit reports (archived at `~/Desktop/BudgetWise-audit-archive/2026-04-22/`) with cross-references to new Phase 2/3/4 code.
**Status:** Read-only consolidation. Fixes proposed at bottom; approval required before auto-fix.

---

## Executive summary

The app is feature-dense and works end-to-end. Two Critical issues from the original audits are **already fixed** in a prior session (credentials scrubbed from git history; `kid_mission_progress` RLS tightened). Two Critical issues remain that need action: the wildcard CORS on the `create-kid-user` edge function, and a systemic defense-in-depth gap on ~40 Supabase mutations that scope by `id` only without `user_id`. Most Important issues are UX polish with real user impact (double-submits, race conditions on mode switch, money-as-float rounding drift, timezone midnight bugs on date strings, forms that lie about success on silent failure). Phase 2/3/4 code mostly landed cleanly but introduces its own small items: `useParentProForKid` fails open intentionally (OK today while Pro is disabled; must tighten when flipped on), notification polling uses localStorage TTL that's trivially forgeable by the signed-in parent, and two new `security definer` triggers need log lines for observability.

**Severity counts (consolidated):**
- Critical: **4** (2 already fixed, 2 open)
- Important: **28**
- Minor: **24**
- Nice-to-have: **14**
- Confirmed safe: **20+**

---

## Critical

### ✅ C1. Supabase PAT + parent password committed to public GitHub — FIXED
`docs/superpowers/plans/2026-04-22-budgetwise-junior-phase-1-foundation.md`, `scripts/screenshots.mjs`. PAT was `sbp_c98609...`. History scrubbed via `git filter-repo --replace-text` + force-push on 2026-04-22. PAT rotated to `sbp_faf323...`. Password rotated via DevTools `supabase.auth.updateUser`. `scripts/screenshots.mjs` now reads from env vars and fails fast. **No further action needed.**

### ✅ C2. Child can self-award any `kid_mission_progress.reward_amount_cents` — FIXED
`supabase/migrations/20260422000004_tighten_mission_progress_rls.sql` replaced the blanket `for all` kid policy with `for select` + constrained INSERT/UPDATE that rejects `reward_amount_cents != null`. Parent keeps unrestricted access via the pre-existing `parent manages own children progress` policy. **No further action needed.**

### 🔴 C3. `create-kid-user` edge function uses `Access-Control-Allow-Origin: *` — OPEN
`supabase/functions/create-kid-user/index.ts:9-13`. Any webpage a signed-in parent visits can call the endpoint with their Supabase JWT (set via `Authorization` header, not cookie — SameSite doesn't help). Attacker can create nuisance child rows, lock out existing kid rows by binding PINs, or read the generated `member_id`/`child_email` from the response. **Fix: origin allowlist.**

```ts
const ALLOWED_ORIGINS = new Set([
  "https://budget-wise-react.vercel.app",
  "https://budget-wise-ruby.vercel.app",
  "http://localhost:5173",
]);
function buildCorsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    Vary: "Origin",
  };
}
```

Reject body parse if origin not in allowlist. Apply the same fix to `admin-actions` in the vanilla repo (same Supabase project).

### 🔴 C4. ~40 client mutations scope by `id` only — defense-in-depth gap — OPEN
Any mutation not scoped by `.eq('user_id', user.id)` would leak data the moment any RLS policy is misconfigured or a new table is added without the right policy. `useExpenses` does this correctly; ~40 other call sites don't. Full list from the parent-side audit:
- `useSavingsGoals.ts:67, 80`
- `MembersPage.tsx:119, 162`
- `ChoresPage.tsx:110, 122, 140, 154, 172, 190`
- `AllowancesPage.tsx:72, 83`
- `FamilyGoalsPage.tsx:157, 177`
- `StokvelPage.tsx:378, 395, 401, 421`
- `BankPage.tsx:388–395, 407–414, 419`
- `useLinkedAccounts.ts:99–101, 110–116`

**Fix:** add `.eq('user_id', user.id)` to each mutation. Low effort (~30 one-liners), high payoff.

---

## Important (28 items)

### Backend / auth / RLS

1. **`create-kid-user` uses `bcryptHashSync` — blocks the edge-function event loop at cost-10.** `index.ts:121`. Either use async `bcrypt.hash`, or drop the hash step entirely — `pin_hash` is written but never read (real auth goes through the Supabase auth user's password, which is derived from PIN server-side). **Recommended: drop the hash entirely.**
2. **Raw DB errors leaked to client in edge function.** `create-kid-user/index.ts:93, 114, 134, 153, 161` return `error.message` directly ("duplicate key value violates…"). Replace with short user-safe strings; log raw to `console.error`.
3. **`kid_ledger` child-read policy could expose cross-family data if `member_id` is ever reused.** Tighten `using` clause to also match `user_id`. (Low-probability; mitigate with a stricter policy.)
4. **`useParentProForKid` fails open when RLS blocks the read.** `src/hooks/useParentProForKid.ts` defaults `isPro=true` when the query returns null. Today that's fine (`ENABLE_PRO_SYSTEM=false` short-circuits); before flipping Pro on, add either a kid-scoped RLS policy on `user_settings.is_pro` or a dedicated edge function.
5. **Notification dedup relies on localStorage — parent can forge.** `junior-sunday-reminder.ts` tracks "already fired this ISO week" in localStorage; a determined user can clear it and re-fire. Low risk (it's their own reminder). Move to a server-side `kid_notifications.scheduled_for`-based check if it ever matters.
6. **Two new `security definer` DB triggers have no logging.** `kid_mission_reward_on_complete` (P3-T2) and `kid_streak_on_activity` (P3-T7) silently swallow edge cases (e.g. `parent_user_id is null`, mission row deleted mid-flight). Add `raise notice` lines behind a debug toggle.

### Data loss / integrity

7. **`AccountPage` "Delete All My Data" has no transaction, no rollback.** Two sequential `.delete()` calls; if second fails, user is half-wiped. Also doesn't delete `family_*`, `stokvel_*`, `linked_accounts`, `user_settings`, `login_events`, `kid_*` — misleading label. Move to an edge function in a transaction; fix the label.
8. **`AccountPage` "Restore from Backup" deletes BEFORE it inserts.** If inserts fail, user has lost everything. Use a staging table or verify insert succeeds before delete. Backup version check `!backup.version` is too weak.
9. **Optimistic UI updates that don't rollback on server failure.** `ChoresPage.markDone/approve/reject/delete`, `MembersPage.handleRemove/handleSubmit`, `AllowancesPage`, `FamilyGoalsPage`. UI lies until refresh. Copy the rollback pattern from `useExpenses.ts:72-111`.
10. **Race conditions on mode switch.** Most data hooks lack the `let cancelled = false` pattern. Mode switch Personal → Business → Personal can let the first (stale) fetch resolve last and overwrite the correct data. Files: `useExpenses`, `useSavingsGoals`, `useUserSettings`, `useLinkedAccounts`, `MembersPage`, `ChoresPage`, `AllowancesPage`, `FamilyGoalsPage`, `StokvelPage`, `AdminPage`. This is very likely the root cause of bug #36 (deep-link-from-website shows personal data).
11. **Money as JS float.** `useSavingsGoals`, `ChoresPage` chore rewards, `StokvelPage` contributions, `AllowancesPage` spent totals. 0.1+0.2 rounding drift accumulates. Short-term: `Math.round((a+b)*100)/100`. Long-term: integer cents.
12. **`new Date().toISOString().split('T')[0]` uses UTC for "today".** After 22:00 in SA time, "today" = tomorrow. Files: `lib/format.ts:24`, `AccountPage.tsx:286`, `StokvelPage.tsx:176, 223`, `AdminPage.tsx:98`. Fix: compute from local year/month/day.
13. **`new Date(dateStr)` parses `YYYY-MM-DD` as UTC midnight.** Files: `SavingsPage.tsx:38`, `FamilyGoalsPage.tsx:234`, `StokvelPage.tsx:188, 543`, `AccountPage.tsx:455-474` streak calc. Compare strings directly instead.

### UX / forms

14. **Forms can double-submit.** No `submitting` guard on `MembersPage.handleSubmit`, `ChoresPage.handleSubmit`, `FamilyGoalsPage.handleSubmit`. Rapid Enter on `OverviewPage.handleQuickAdd` bypasses the guard.
15. **Fallback catch swallows all errors.** `useLinkedAccounts.ts:59-67` falls back on any error, not just missing column — could leak business accounts into personal view. `StokvelPage.tsx:159-163` shows "no groups" when the fetch actually failed.
16. **Google OAuth `redirectTo: /dashboard` flashes parent UI before role gate.** Kids don't sign in via Google today, but latent.
17. **Password reset `redirectTo: origin/` breaks on preview deploys.** Hardcode production origin or env-gate.
18. **Password recovery UX itself is broken.** Tracked as #35 — reset link signs user in but doesn't show change-password form.
19. **No `maxLength` on most text inputs.** Users can paste 1MB strings. Only 3 `maxLength` usages in the whole app.
20. **Inputs not trimmed on submit.** `ExpenseModal`, `StokvelPage` stokvel/bank_ref, `FamilyGoalsPage` name. Emoji-only / zero-width chars render blank.
21. **`parseFloat` with no validation — `NaN`/`Infinity` pipes into DB.** `StokvelPage:246,345`, `SavingsPage:93-94` silently maps NaN→0, `AllowancesPage` ignores non-numbers silently.
22. **62 `alert()`/`confirm()`/`prompt()` calls.** Worst: `FamilyGoalsPage:143-151` (2-step prompt), `AllowancesPage:67`, `BankPage:404`. Replace with inline modals.
23. **`window.location.reload()` used as refresh hammer.** `AccountPage.tsx:214, 355, 377`. Loses state in other tabs. Use `refresh` from `useUserSettings` instead.
24. **`budget_limits` fallback silently loses data between sessions.** `ExpensesPage:104-157` — transient DB error routes reads to localStorage. Different devices get different data, UI doesn't say so.
25. **OCR/receipt scan has no timeout or cancel.** `OverviewPage:101-119` — Tesseract.js hang leaves scanning overlay forever.
26. **`dedupeRecent` in `useOverviewStats` hides legit duplicates.** Coffee AM + coffee PM collapse. Users think second purchase wasn't saved.
27. **`streakDays` recalc on every AccountPage render, 365-loop worst case.** Wrap in `useMemo([expenses])`.
28. **`AddKidModal.handleRemove` uses `window.confirm` + `window.prompt`.** Flagged as fine in Junior audit BUT Capacitor's webview doesn't reliably intercept `window.prompt` — silent failure on Android. Replace with styled modal.

---

## Minor (24 items — top 10 only, rest in archive)

1. Rate-limit 429 on repeated wrong PINs collapses to "Wrong PIN." Branch on `error.status === 429`.
2. Dead-link `/junior/login?as=<bad-uuid>` shows misleading "Wrong PIN". Add cheap existence check.
3. CSS `styles-junior.css` targets `button` but `NavLink` renders `<a>` — bottom nav uses default anchor styles. Change selectors to `a` / `a.active`.
4. Inline styles pervasive across Junior files. Extract to CSS classes.
5. Color swatches lack `:focus-visible` outline.
6. `kid_ledger.source_id` has no FK — dangling IDs after source-row delete.
7. `AddKidModal` and `ShowKidLinkModal` use `document.getElementById` for clipboard fallback — use refs.
8. `fetchKidMemberForUser` errors swallowed by `useKidProfile` — `AuthRoleGate` silently treats them as "parent".
9. `useKidProfile` deps `[user, authLoading]` refetches on every token refresh; should be `[user?.id, authLoading]`.
10. Edge function missing logging — no `console.info` on success, no `console.error` with context on failure.

---

## Nice-to-have (14 items — top 5)

1. `AddKidModal` success view has no "Add another kid" button.
2. `useKidProfile` refetched on every `AuthRoleGate` navigation — cache via context or TanStack Query.
3. `JuniorLoginPage` could preview kid's avatar/name before PIN (builds trust on shared devices).
4. `dedupeRecent` behaviour is non-obvious — either document or remove.
5. Type casts with `as unknown as` in ExpensesPage + BankPage — tidy up types.

---

## Confirmed safe (20+ items — selection)

- Same-PIN-across-kids: `derivePassword` salts with 8 hex of member UUID — collision-free.
- `20260422000001_tighten_kid_ledger_parent_rls.sql` re-run safety: idempotent.
- `signInAsKid` session-persistence race: SDK writes to localStorage before the promise resolves.
- Double-click "Add kid": `canSubmit` + `disabled` guards are tight.
- Kid-ledger parent→parent cross-family: `with_check` explicitly requires `member_id in (select id from family_members where user_id = auth.uid())`.
- Kid-ledger child-read sibling isolation: `auth_user_id` is unique per kid.
- `onAuthStateChange` cleanup: unsubscribes correctly.
- `useKidProfile` cancellation: uses `cancelled` flag.
- `AuthRoleGate` doesn't infinite-loop: mutual role redirects land on stable routes.
- Parent session expiring while `AddKidModal` open: fresh `getSession()` + clean error path.

---

## Fix plan (proposed priority)

### Tier 1 — Ship-blocking (fix before any merge to main)

- **C3 (CORS allowlist on `create-kid-user`)** — 10 min. Immediate risk to signed-in parents.
- **C4 (add `user_id` scoping to all ~40 mutations)** — 2 hours. Mechanical. Huge defense-in-depth payoff.
- **Important #7 (Delete All My Data) + #8 (Restore from Backup)** — 2 hours. Real data-loss risk.

### Tier 2 — High-impact UX (next sprint)

- **Important #10 (race on mode switch + cancelled flag)** — 2 hours. Likely root cause of user-reported bug #36.
- **Important #9 (optimistic rollback in Family/Chores/Goals pages)** — 2 hours. UI no longer lies on failure.
- **Important #14 (`submitting` guards on 4 forms)** — 30 min.
- **Important #12 + #13 (timezone fixes)** — 1 hour. Affects date display correctness for all SA users.

### Tier 3 — Polish before Pro flip

- **Important #4 (`useParentProForKid` fail-open → fail-closed)** — 30 min + migration.
- **Important #2 (edge-function error message sanitization)** — 20 min.
- **Important #22 (replace `alert`/`prompt`/`confirm`)** — 4 hours, spread across files.
- **Minor #3 (CSS selector `button` → `a` in Junior nav)** — 5 min. Fixes the looks-broken bottom nav.
- **Minor #9 (`useKidProfile` dep array fix)** — 5 min. Stops unnecessary re-fetches on token refresh.

### Tier 4 — Long-term

- Money as integer cents throughout.
- Replace all `parseFloat` with strict numeric validation.
- `maxLength` on every text input.
- Structured logging in edge function.
- TanStack Query for all data hooks (fixes races + adds caching).

---

## Phase 2/3/4 code not covered by original audits

Brief pass on code that shipped after the original audits ran (between 2026-04-22 11:00 and 14:00):

- **P2 Settle-up modal** — batch update uses single `.eq().eq()` chain; correct. RLS policy for "parent manages own ledger" is tightened. No net-new issues.
- **P3 mission trigger** (`kid_mission_reward_on_complete`) — `security definer`, derives `parent_user_id` correctly. Needs logging (minor #10 applies). The `if reward_cents > 0` guard means missions with no configured reward silently produce no ledger row — intentional, but worth a comment.
- **P3 streak trigger** — same logging concern. Uses `current_date` (Postgres server local time, typically UTC) so the "did streak break" math may flip on DST boundaries. Low risk.
- **P4 freemium gates** — `checkJuniorGate` is pure-functional and testable. `JuniorUpgradeModal` hardcodes the PayPal URL — move to a shared constant when the existing Pro flow is finished.
- **P4 notification polling** — 30s interval. `DashboardLayout` starts it only for parents (`!isChild`). Drain-mark-sent happens per-notification; if `showNotification` throws, the row stays `pending` and will be tried next tick — good.
- **P4 Sunday reminder** — localStorage dedupe is forgeable (Important #5). Functionally OK for now.
- **P4 multi-kid lock screen** — localStorage holds (memberId, name, color). Not sensitive beyond what's on-device anyway. Capped at 5 kids. Good.

**Net-new finding:** `ChoresPage.approveChore` drops the legacy `earned`/`allowance` column credit on non-Junior kids (flagged as DONE_WITH_CONCERNS during P2-T2). Adult family members still show zero credit in the UI. If users rely on that old accounting, it's a regression. Recommend: restore the `else` branch for `role !== 'child'`.
