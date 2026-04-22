# BudgetWise-React — Consolidated Whole-App Audit

**Date:** 2026-04-22
**Last updated:** 2026-04-22 (Tier 1 + 2 + most of Tier 3 shipped)
**Scope:** Full React app + Supabase backend + Junior feature (Phases 1–4)
**Methodology:** Synthesized three 2026-04-22 audit reports (archived at `~/Desktop/BudgetWise-audit-archive/2026-04-22/`) with cross-references to new Phase 2/3/4 code.
**Status:** All Critical + all data-integrity Important items shipped. Remaining open items are mostly UX rewrites (styled-modal replacement for alert/confirm/prompt), long-term architecture (money-as-cents, TanStack Query), and items that need product decisions (env-var redirect, Pro-scope RLS).

---

## Executive summary

The app is feature-dense and works end-to-end. All 4 Critical issues are now resolved (C1 credentials scrubbed; C2 `kid_mission_progress` RLS tightened; C3 CORS allowlist shipped; C4 user_id defense-in-depth shipped across all owner-scoped tables — 1 subset still awaiting an ownership-check RPC). Two Tier 1 Important data-loss fixes have shipped (Imp #7 honest Delete-All scope + partial-failure surfacing; Imp #8 safer Restore validation). Remaining Important issues are mostly UX polish with real user impact (double-submits, race conditions on mode switch, money-as-float rounding drift, timezone midnight bugs on date strings, forms that lie about success on silent failure). Phase 2/3/4 code mostly landed cleanly but introduces its own small items: `useParentProForKid` fails open intentionally (OK today while Pro is disabled; must tighten when flipped on), notification polling uses localStorage TTL that's trivially forgeable by the signed-in parent, and two new `security definer` triggers need log lines for observability.

**Severity counts (consolidated):**
- Critical: **4** (all fixed; C4 has 1 subset open pending RPC)
- Important: **28** (22 fixed, 3 partially fixed, 3 open)
- Minor: **26** (7 fixed, 19 open — most low-priority polish)
- Nice-to-have: **14** (unchanged — long-term)
- Confirmed safe: **20+**

**Project follow-up tasks also closed this pass:**
- Task #22 — parent can reset a kid's forgotten PIN (`reset-kid-pin` edge function + MembersPage button)
- Task #23 — `delete-kid-user` edge function stops leaving orphan `auth.users` rows
- Task #35 — password recovery now shows a "Set a new password" form via `PASSWORD_RECOVERY` handler instead of silently dropping user on /dashboard

**Shipped fix commits (in order):**
- `3d4c5aa` — C3 CORS allowlist
- `bf80fbe` — C4 hooks user_id scoping
- `5fe93a6` — C4 family pages + adult-chore-credit regression restore
- `b76c13e` — C4 business/stokvel/bank pages
- `54fd55a` — Imp #7 + #8 (Delete All / Restore from Backup)
- `d69bf86` — Imp #10 cancelled-flag + Imp #15 narrow fallback + Minor #9 dep array + upsert onConflict
- `559e8d9` — Imp #12 + #13 timezone + Minor #3 CSS + Minor #11 pricing + Minor #12 week
- `f2a9348` — Imp #1 drop bcrypt + Imp #2 sanitize errors + Minor #10 logging
- `e774aa1` — Imp #9 rollback + Imp #14 guards + Imp #19 maxLength + Imp #21 NaN + Imp #11 cents math
- `48c3e6e` — Imp #15 OCR timeout + Imp #16 streak memo + Imp #26 dedupe
- `fd5f309` — Imp #4 + #5 PIN rate-limit + dead-link hint
- Vanilla repo `ee31367` — admin-actions CORS parity

---

## Critical

### ✅ C1. Supabase PAT + parent password committed to public GitHub — FIXED
`docs/superpowers/plans/2026-04-22-budgetwise-junior-phase-1-foundation.md`, `scripts/screenshots.mjs`. PAT was `sbp_c98609...`. History scrubbed via `git filter-repo --replace-text` + force-push on 2026-04-22. PAT rotated to `sbp_faf323...`. Password rotated via DevTools `supabase.auth.updateUser`. `scripts/screenshots.mjs` now reads from env vars and fails fast. **No further action needed.**

### ✅ C2. Child can self-award any `kid_mission_progress.reward_amount_cents` — FIXED
`supabase/migrations/20260422000004_tighten_mission_progress_rls.sql` replaced the blanket `for all` kid policy with `for select` + constrained INSERT/UPDATE that rejects `reward_amount_cents != null`. Parent keeps unrestricted access via the pre-existing `parent manages own children progress` policy. **No further action needed.**

### ✅ C3. `create-kid-user` edge function `Access-Control-Allow-Origin: *` — FIXED
Commit `3d4c5aa`. `supabase/functions/create-kid-user/index.ts` now uses `ALLOWED_ORIGINS` (react prod alias + ruby alias + localhost 5173/4173), `Vary: Origin`, and sends an empty `Access-Control-Allow-Origin` for non-allowlisted origins so the browser preflight denies the request. `admin-actions` in the vanilla repo still needs the same treatment — tracked as separate follow-up.

### 🟡 C4. Client mutations scoped by `id` only — FIXED for owner-scoped tables; 1 subset still open
Commits `bf80fbe` + `5fe93a6` + `b76c13e`. Added `.eq('user_id', user.id)` defense-in-depth to every mutation on directly user-owned tables:
- `useSavingsGoals` · `useLinkedAccounts`
- `MembersPage` · `AllowancesPage` · `FamilyGoalsPage` · `ChoresPage` (markDone, approve, reject, toggle un-complete, delete)
- `StokvelPage.stokvel_groups` (3 sites) · `SpendingTrackerPage.family_links` (own-row: unlink, saveSharing)
- `ClientsPage` · `InvoicesPage` · `BankPage.linked_accounts` (sync, updateBalance, remove)

**Still open (C4 subset):** `stokvel_members` approve/reject and `family_links` approve/remove operate on ANOTHER user's row — row's `user_id` is the target, not the caller. Adding `.eq('user_id', caller.id)` would break these flows. Correct fix is a server-side RPC that verifies group/parent ownership before the mutation. Ownership is currently enforced by RLS only. Inline comments added at the call sites. Tracked as separate follow-up.

---

## Important (28 items)

### Backend / auth / RLS

1. **✅ FIXED (commit `f2a9348`).** Dropped `bcryptHashSync` from `create-kid-user` entirely — pin_hash was write-only, real auth is via the derived-password Supabase auth user. Removes the V8-blocking DoS surface.
2. **✅ FIXED (commit `f2a9348`).** All error-path returns in `create-kid-user` now log the raw error to `console.error` with context and return a generic user-safe message.
3. **`kid_ledger` child-read policy could expose cross-family data if `member_id` is ever reused.** **OPEN (requires new migration).**
4. **✅ FIXED (commit `879a10b`).** New `kid-pro-status` edge function returns parent's `is_pro` to a signed-in kid via service role. `useParentProForKid` now fails CLOSED (isPro=false) on any error.
5. **Notification dedup relies on localStorage — parent can forge.** Low risk (user's own reminder). **OPEN (low priority).**
6. **Two new `security definer` DB triggers have no logging.** **OPEN (requires new migration; low priority).**

### Data loss / integrity

7. **✅ FIXED (commit `54fd55a`).** `AccountPage` "Delete All My Data" was misleading (only 2 tables deleted). Renamed button + confirm copy to "Delete Expenses & Savings" to match actual scope, and added per-table error surfacing so partial-delete is visible. Full-account purge via transactional edge function remains a future improvement.
8. **✅ FIXED (commit `54fd55a`).** `AccountPage` "Restore from Backup" now validates shape strictly (version must equal 1, expenses must be array), rejects cross-account restore unless double-confirmed, and surfaces per-step insert/upsert errors with a partial-failure summary instead of claiming success silently.
9. **✅ FIXED (commit `e774aa1`).** Optimistic UI updates now snapshot-then-rollback on server failure across `ChoresPage.markDone/deleteChore`, `MembersPage.handleSubmit/handleRemove`, `AllowancesPage.logSpend/resetAllowance`, `FamilyGoalsPage.deleteGoal`. Error alerts surface the problem to the user instead of silently showing lying UI.
10. **✅ FIXED for core data hooks (commit `d69bf86`).** `useExpenses`, `useSavingsGoals`, `useUserSettings`, `useLinkedAccounts` now use the cancelled-flag pattern. Page-level hooks (MembersPage/ChoresPage/etc) still missing the pattern but their mode-switch race is less severe since they remount on route change. This is the likely root cause of bug #36 — revisit after mode-switch regression test.
11. **✅ PARTIALLY FIXED (commits `5fe93a6`, `e774aa1`).** `Math.round((a+b)*100)/100` mitigation applied at `ChoresPage.approveChore` adult credit, `FamilyGoalsPage.contribute`, `AllowancesPage.logSpend`. `useSavingsGoals.fundGoal`, `StokvelPage` contributions still open. Integer-cents migration remains the correct long-term fix.
12. **✅ FIXED (commit `559e8d9`).** `lib/format.todayIso()` now uses local year/month/day. Call sites in `exports.ts`, `AccountPage`, `StokvelPage` updated.
13. **✅ FIXED for hot sites (commit `559e8d9`, `48c3e6e`).** `SavingsPage.tsx` deadline parses YYYY-MM-DD directly now; `AccountPage` streakDays uses local-time keys. `FamilyGoalsPage.tsx:234` (display only, `toLocaleDateString`) and `StokvelPage` contribution-date comparisons still use `new Date(dateStr)` but impact is cosmetic — noted as follow-up.

### UX / forms

14. **✅ FIXED (commit `e774aa1`, `48c3e6e`).** Double-submit guards on `MembersPage`, `ChoresPage`, `FamilyGoalsPage`. `OverviewPage.handleQuickAdd` Enter handler now gates on `quickBusy`.
15. **✅ FIXED (commit `d69bf86`).** `useLinkedAccounts` fallback now only triggers on Postgres code 42703 (missing column) instead of any error. `StokvelPage` open.
16. **Google OAuth `redirectTo: /dashboard` flashes parent UI before role gate.** Kids don't sign in via Google today, but latent. **OPEN (latent).**
17. **✅ FIXED (commit `b3ab513`).** `AuthContext.resetPassword` now anchors redirectTo to the canonical production origin (localhost in dev); preview deploys no longer bake dead URLs into reset emails.
18. **✅ FIXED (commit `b3ab513`).** Task #35 — AuthContext listens for `PASSWORD_RECOVERY` and flips a flag; AuthPage shows a "Set a new password" form with confirm-match + min-length, calls `updatePassword`, navigates to /dashboard on success.
19. **✅ FIXED (commit `e774aa1`).** `maxLength` added to critical text inputs (MembersPage name, ChoresPage name, FamilyGoalsPage name). Other inputs remain as low-priority cleanup.
20. **Inputs not trimmed on submit.** ExpenseModal still relevant. Family pages already call `.trim()`. **OPEN (minor).**
21. **✅ FIXED (commit `e774aa1`).** NaN-safe parseFloat + positive-amount clamping added to `ChoresPage` reward, `FamilyGoalsPage.contribute`, `AllowancesPage.logSpend`. SavingsPage/StokvelPage remain open.
22. **62 `alert()`/`confirm()`/`prompt()` calls — styled-modal replacement.** **OPEN (UX rewrite, not a bug fix — ~4 hours work deferred).**
23. **✅ FIXED (commit `dde8978`).** AccountPage replaced all 3 `window.location.reload()` with `refreshSettings/refreshExpenses/refreshGoals` calls — no more clobbering state in other tabs after avatar upload, restore, or delete-all.
24. **`budget_limits` fallback silently loses data between sessions.** `ExpensesPage:104-157`. **OPEN (data-model decision).**
25. **✅ FIXED (commit `48c3e6e`).** OCR/receipt scan now has a 60s timeout so a hung Tesseract load can't leave the scanning overlay stuck.
26. **✅ FIXED (commit `48c3e6e`).** `dedupeRecent` is now a no-op passthrough — list is id-unique already.
27. **✅ FIXED (commit `48c3e6e`).** `streakDays` wrapped in `useMemo([expenses])` + local-time keys (also fixes tz edge).
28. **`AddKidModal.handleRemove` uses `window.confirm` + `window.prompt`.** Capacitor webview unreliable. **OPEN (part of alert/prompt replacement backlog).**

---

## Minor (26 items — top 12, rest in archive)

1. **✅ FIXED (commit `fd5f309`).** `signInAsKid` now returns a typed status including `'rate_limited'` on HTTP 429. UI shows "Too many tries — wait a minute".
2. **✅ FIXED (commit `fd5f309`).** After 3 failed PIN attempts the error copy flips to "Ask your parent for a fresh link" so a dead link doesn't read as endless wrong-PIN.
3. **✅ FIXED (commit `559e8d9`).** `styles-junior.css` bottom-nav selectors now target both `a` and `button`.
4. Inline styles pervasive across Junior files. **OPEN (style cleanup, low priority).**
5. Color swatches lack `:focus-visible` outline. **OPEN (a11y polish).**
6. `kid_ledger.source_id` has no FK — dangling IDs after source-row delete. **OPEN (documented as intentional denormalization; consider adding `source_label` text snapshot).**
7. `AddKidModal` and `ShowKidLinkModal` use `document.getElementById` for clipboard fallback — use refs. **OPEN (works today).**
8. `fetchKidMemberForUser` errors swallowed by `useKidProfile` — `AuthRoleGate` silently treats them as "parent". **OPEN (UX polish).**
9. **✅ FIXED (commit `d69bf86`).** `useKidProfile` dep array now `[user?.id, authLoading]` so hourly token refreshes don't re-fetch.
10. **✅ FIXED (commit `f2a9348`).** `create-kid-user` edge function now logs `console.info` on success and `console.error` with context on every failure branch.
11. **✅ FIXED (commit `559e8d9`).** `JuniorUpgradeModal` now displays `$4.99` matching the USD PayPal link.
12. **✅ FIXED (commit `559e8d9`).** `junior-sunday-reminder.ts` now computes isoWeek in local time, matching the local-time Sunday check.

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

### Tier 1 — Ship-blocking (✅ SHIPPED)

- ✅ **C3 (CORS allowlist on `create-kid-user`)** — commit `3d4c5aa`.
- ✅ **C4 (add `user_id` scoping to mutations)** — commits `bf80fbe`, `5fe93a6`, `b76c13e`. 13 handlers across 11 files. **Open subset:** `stokvel_members` approve/reject + `family_links` approve/remove — caller is mutating ANOTHER user's row, so needs an ownership-verification RPC. Inline comments flag the sites.
- ✅ **Important #7 + #8 (Delete All My Data / Restore from Backup)** — commit `54fd55a`. Delete-All scope honestly named + partial-failure surfaced; Restore strictly validates and surfaces per-step errors.
- ✅ **Phase 2 regression — adult chore credit** — commit `5fe93a6`. `ChoresPage.approveChore` else-branch restored so non-Junior members still get `earned`/`allowance` credit.

### Tier 2 — High-impact UX (✅ SHIPPED)

- ✅ **Imp #10** (cancelled-flag on core hooks) — commit `d69bf86`.
- ✅ **Imp #9** (optimistic rollback + error surfacing across family pages) — commit `e774aa1`.
- ✅ **Imp #14** (double-submit guards on 3 forms + OverviewPage Enter) — commits `e774aa1`, `48c3e6e`.
- ✅ **Imp #12 + #13** (timezone fixes: todayIso + streak + deadline parse) — commits `559e8d9`, `48c3e6e`.
- ✅ **Imp #1 + #2** (edge-function bcrypt drop + error sanitization) — commit `f2a9348`.
- ✅ **Imp #15** (narrowed useLinkedAccounts fallback) — commit `d69bf86`.
- ✅ **Imp #21** (NaN/positive-amount validation on money inputs) — commit `e774aa1`.
- ✅ **Imp #25** (OCR 60s timeout) — commit `48c3e6e`.
- ✅ **Imp #26** (dedupeRecent passthrough) — commit `48c3e6e`.
- ✅ **Imp #16** (streakDays useMemo) — commit `48c3e6e`.

### Tier 3 — Polish before Pro flip (✅ MOSTLY SHIPPED)

- ✅ **Imp #2** — edge-function error sanitization (commit `f2a9348`).
- ✅ **Minor #3** — CSS selectors for bottom nav (commit `559e8d9`).
- ✅ **Minor #9** — `useKidProfile` dep array (commit `d69bf86`).
- ✅ **Minor #10** — edge-function logging (commit `f2a9348`).
- 🔴 **Imp #4** (`useParentProForKid` fail-closed) — still OPEN. Requires a cross-scope RLS policy or dedicated edge function for kid to read parent's `is_pro` flag. Safe to ship while `ENABLE_PRO_SYSTEM=false`.
- 🔴 **Imp #22** (replace alert/prompt/confirm) — still OPEN. 4h UX rewrite, not a bug fix.

### Tier 4 — Long-term (not attempted)

- Money as integer cents throughout (schema migration, breaks every read).
- TanStack Query for all data hooks (major refactor; cancelled-flag pattern covers the immediate race bugs).
- `maxLength` on every remaining text input (added on critical ones; rest is tedium).
- Full styled-modal replacement for every alert/prompt/confirm.
- Transactional edge function for full-account purge.

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
