# BudgetWise Junior — Phase 6: Age Brackets, Curriculum, and Graduation

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to execute task-by-task. Checkboxes (`- [ ]`) track progress.

**Goal:** Make Junior actually feel age-appropriate. Split kids into 4 age brackets (7-9, 10-12, 13-15, 16-17), deliver a bracket-specific mission curriculum, tune the visual system per bracket, and add an 18th-birthday graduation flow to a real BudgetWise account.

**Why this phase matters:** Junior's strategic North Star is **"educational for kids = bait for parents."** A 7-year-old and a 16-year-old can't share missions or UI — the younger one needs a mascot, huge tap targets, and cartoon metaphors; the older one wants budgeting basics that sound like adult-lite financial literacy, not kid-tv. Without age brackets the product can only target the middle (10-13) and loses everyone else.

**What ships at end of phase:** A parent can add a kid with a date of birth, the kid sees missions calibrated to their bracket, the home page styling shifts per bracket, and a kid turning 18 gets a one-button path to a real BudgetWise account that keeps their savings history.

**Repo:** `~/Desktop/BudgetWise-React/`. Work on branch `junior-phase-6-age-brackets`. One atomic commit per task.

**Depends on:** Phase 5 shipped (PR #6, merge `5580909`), Phase 3 polish shipped (PR #7, merge `fc4f0c4`).

---

## Decisions needed before T1

Answer these before writing any code. They're load-bearing; reversing them mid-phase means a migration.

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D1 | Age splits — 3 or 4 brackets? | **4: 7-9 / 10-12 / 13-15 / 16-17** | Developmentally distinct stages (early primary, late primary, early teen, late teen). 3 brackets collapses 13-17 which is too wide. |
| D2 | Age source — snapshot int or derived from DOB? | **Derive from `date_of_birth`** | DOB is stable, age goes stale. `family_members.date_of_birth` already exists (Phase 1 migration line 12). AddKidModal currently collects `age` only — T2 swaps to DOB. |
| D3 | Content strategy — write, license, or adapt? | **Write original, anchored to primary sources (SARS, SARB, FSCA consumer pubs). Avoid Khan Academy.** | First draft recommended Khan Academy Kids — but Khan content is typically **CC-BY-NC-SA (non-commercial)** and BudgetWise has a paid Pro tier, so adapting it for the product is likely a licence violation. Only MyMoney.gov (US fed, public domain) is commercially-safe off the shelf, but it's dollar/SARS-agnostic and needs heavy SA localisation. Cleanest path: write original kid-voice missions, cite primary factual anchors (current tax rates from SARS, interest from Reserve Bank, etc.). No licensing risk, faster than licence negotiation, easier to localise. |
| D4 | Initial mission count per bracket | **5 per bracket, 20 total for v1** | Enough to prove the age-gating feel; small enough to actually write. More added post-launch. |
| D5 | Visual differentiation — radical or subtle? | **Subtle per-bracket palette + type scale; shared component library** | Radical splits (different mascots, wildly different components) multiply maintenance 4×. Subtle shifts (warmer vs cooler palette, rounder vs tighter corners, font size down as age goes up) feel tailored without forking the codebase. |
| D6 | Graduation timing — at 18th birthday, or in the month before? | **30-day advance notice, auto-prompt on first login after 18** | Advance notice lets the kid plan. Hard cutoff on birthday feels abrupt. |
| D7 | What survives graduation? | **Savings goal, jar balances, streak, completed missions** | These represent earned progress. Chore and ledger history is parent-scoped; it stays in the family account. |
| D8 | Enforce under-18 at add time? | **Already done (PR #7, AddKidModal age 7-17 required)** | ✅ No further work. |

**User sign-off required on D1, D3, D5, D6, D7 before T1.**

---

## Task 0: Pre-flight

- [ ] Confirm D1–D7 with user. Commit their answers to this doc as an amendment at the top.
- [ ] `git checkout -b junior-phase-6-age-brackets` from main.
- [ ] `npm run typecheck` — must be clean before starting.

---

## Task 1: Schema migration — age brackets on missions

**File:** `supabase/migrations/<timestamp>_junior_phase6_age_brackets.sql`

Add age-range columns to `kid_missions`, backfill the one existing seed mission, and add a check constraint so future inserts must specify a range.

```sql
alter table kid_missions
  add column if not exists age_min smallint,
  add column if not exists age_max smallint;

-- Backfill: seed mission is for 7-12 (broad) until T4 replaces it.
update kid_missions set age_min = 7, age_max = 12
where age_min is null;

alter table kid_missions
  alter column age_min set not null,
  alter column age_max set not null,
  add constraint kid_missions_age_range_sane
    check (age_min between 7 and 17 and age_max between age_min and 17);

create index if not exists kid_missions_age_range_idx
  on kid_missions (age_min, age_max);
```

**Verify:**
- `supabase db push` succeeds
- `select count(*) from kid_missions where age_min is null` returns 0
- Constraint blocks `insert ... (age_min=5, age_max=10)` and `age_min=12, age_max=10`

---

## Task 2: AddKidModal — switch age → DOB

**File:** `src/components/AddKidModal.tsx`

The age-7-17 input shipped in PR #7 is a good gate but age goes stale. Replace with a date-of-birth picker that writes to `family_members.date_of_birth`. Derive age client-side for the current "is 7-17?" check.

- [ ] Replace `<input type="number">` with `<input type="date">`. Required.
- [ ] Client-side compute: `age = Math.floor((now - dob) / 365.25 days)`. If `age < 7 || age > 17`, disable submit with message "BudgetWise Junior is for kids 7–17."
- [ ] Pass `date_of_birth` (ISO date) to the `create-kid-user` edge function. Also keep `age` for backward-compat with the function until T3.

**File:** `supabase/functions/create-kid-user/index.ts`

- [ ] Accept `date_of_birth` in the request body (optional for now, required after backfill complete).
- [ ] Write `date_of_birth` onto the `family_members` row.

**Verify:**
- Adding a new kid with DOB `2016-01-01` (a 10-year-old) creates a row with `date_of_birth = '2016-01-01'`.
- Attempting DOB `2010-01-01` (a 16-year-old, fine) or `2005-01-01` (a 21-year-old, blocked) behaves correctly.

---

## Task 3: Existing-kid DOB backfill

Existing kids created before Phase 6 have `age` populated but `date_of_birth = null`. Age snapshots will drift. Options:

1. **Approximate backfill:** `date_of_birth = (now - age years).start_of_year()`. Safe but imprecise.
2. **Parent-prompted backfill:** Banner on `/dashboard/junior` "Add birthday for {name}" → DOB picker modal per kid missing DOB. Most accurate.

**Recommendation:** Do (2). Existing kids are few (single-digit per account today) and parents know their kids' birthdays.

- [ ] Add `<BirthdayBackfillBanner />` component, shown on JuniorDashboardPage when `family_members.role='child' AND auth_user_id IS NOT NULL AND date_of_birth IS NULL`.
- [ ] Each banner offers one-click "Add birthday" button → modal with date picker → updates `family_members.date_of_birth`.

**Verify:** After adding DOB for every existing kid, banner disappears.

---

## Task 4: useKidMissions filters by age

**File:** `src/hooks/useKidMissions.ts`

- [ ] Read kid's `date_of_birth`, compute age, filter `kid_missions` where `age_min <= age <= age_max`.
- [ ] If DOB is null (shouldn't happen post-T3, but defensive): fall back to unfiltered list.

**Gotcha:** `progressByMission` filters off the same list, so no separate fix needed.

---

## Task 5: Mission curriculum — 20 missions authored

**Structure:** Each mission is a row in `kid_missions` with a `body.steps` array matching `MissionStep` union (hook / concept / quiz / tie_in / done) from `JuniorMissionPlayer.tsx:16`.

**Source strategy (D3 updated):** Write original kid-voice missions. Cite primary factual anchors when needed:
- SARS for tax rates / brackets (https://www.sars.gov.za/)
- South African Reserve Bank for interest rate / inflation framing
- FSCA **consumer publications** for SA-specific concepts (stokvel basics, banking-charge disclosures) — these are public regulator bulletins, safe to reference factually without copying prose
- **Avoid** Khan Academy content (likely CC-BY-NC-SA, conflicts with Pro tier)
- MyMoney.gov content exists as a fallback / comparison only — not a primary source because it's US-centric

**Attribution:** Missions don't need an "adapted from" footer (content is original). Factual-claim missions cite the primary source inline where relevant, e.g. "UIF is 1% of your pay (SARS rule)."

### Mission list (5 per bracket)

**7-9 (Money is a tool)**
1. What is money, really? — trade / barter / coins
2. Needs vs wants — quick sort game
3. Why do we save? — delayed gratification story
4. Three jars — intro to save/spend/give
5. Counting change — simple R1/R5/R10 math quiz

**10-12 (Earning and choosing)**
1. Every rand is a choice — opportunity cost
2. Why do prices differ? — same product, different shop
3. What's a budget? — income - needs - wants
4. Saving for a goal — goal math (target / weekly = weeks)
5. Scams for kids — "you've won" red flags

**13-15 (Budgeting basics)**
1. 50/30/20 rule — adult budgeting intro
2. Interest — what banks pay, what credit cards charge
3. Tax — why a R100 thing costs R115
4. Impulse buying — the 24-hour rule
5. Your first bank account — features to look for

**16-17 (Adult lite)**
1. Credit vs debit — when each matters
2. Credit score basics — what builds it, what breaks it
3. First salary — gross vs net, UIF, SARS
4. Rent vs buy — early mental model
5. Emergency fund — why 3 months matters

- [ ] One SQL migration per bracket (4 migrations) inserts 5 mission rows each. Keeps blast radius small — reverting one bracket doesn't hit the others.
- [ ] `body.steps` for each mission has exactly one of each type (hook → 1-2 concepts → quiz → tie_in → done) — authoring template in `docs/superpowers/specs/2026-04-24-junior-mission-authoring-template.md` (create as T5.0).

**Verify:**
- Kid age 8 (bracket 7-9) sees only those 5 missions on `/junior/missions`
- Kid age 14 (bracket 13-15) sees only those 5 missions
- Parent JuniorDashboardPage mission-count tile shows bracket-filtered count

---

## Task 6: Age-aware visual system

**Goal:** Styling shifts subtly per bracket. Shared component library, bracket-level CSS variables.

**Approach:**
1. `JuniorLayout` reads kid's age and sets `data-bracket="7-9"` (or `"10-12"`, etc.) on `.junior-shell`.
2. `src/styles-junior.css` defines `[data-bracket="..."] { --junior-accent: ... }` blocks.
3. Components read `var(--junior-accent)`.

**Per-bracket palette (recommendation — confirm on D5):**

| Bracket | Primary | Accent | Hero gradient | Type scale |
|---|---|---|---|---|
| 7-9 | `#f59e0b` (playful orange) | `#ec4899` (magenta) | warm sunrise | `1.1×` (bigger) |
| 10-12 | `#10b981` (current green) | `#3b82f6` (blue) | meadow | `1.0×` (current) |
| 13-15 | `#3b82f6` (cooler blue) | `#8b5cf6` (purple) | sky | `0.95×` |
| 16-17 | `#1e293b` (near-black) | `#10b981` (accent) | slate | `0.9×` (tighter, more adult) |

- [ ] T6.1: add `data-bracket` attr in `JuniorLayout.tsx`
- [ ] T6.2: add bracket-scoped CSS variables in `styles-junior.css`
- [ ] T6.3: replace hard-coded `#10b981` in Junior component inline styles with `var(--junior-accent)` — inventory first via `rg '#10b981' src/pages/junior/ src/components/junior/`
- [ ] T6.4: add one bracket-specific flourish: **7-9 only** shows a subtle mascot SVG in the home-page hero corner (new asset `public/junior-mascot-7-9.svg`; simple smiling piggy or coin character, 80px)

**Verify:** Four kids of ages 8, 11, 14, 17 on the same device (sign-in-switching via Kids dropdown) each see visually distinct home pages with matching mission player accents.

---

## Task 7: 18th-birthday graduation flow

**Detect:** on any Junior page load, if `age >= 17 && days_to_18 <= 30`, show `<GraduationBanner />`. On first load after `age >= 18`, show a full-page `<GraduationWizard />` with no dismiss option.

**GraduationWizard flow (3 steps):**
1. **Explain** — "You're 18 — time for your own BudgetWise account. Your savings, streak, and mission history come with you. Chore history stays with your family."
2. **Email** — grad picks their own email (can't reuse parent-generated internal one). Optional phone.
3. **Password + confirm** — kid sets their own password. PIN retired.

**Backend:**
- New edge function `supabase/functions/graduate-kid/index.ts`:
  - Validates caller is the kid themselves (not parent — kid is consenting to the account change)
  - Updates `auth.users.email` via admin API
  - Sets new password via admin API
  - Updates `family_members.role` to `graduated_adult` (new enum value) or migrates to a separate table
  - Creates baseline rows in `user_settings` (copies jar_split as opening income split guidance)
  - Logs a `login_events` row with `kind='graduation'`
- Needs `--no-verify-jwt` per project ES256 gotcha.

**Client:**
- After graduation, route to `/dashboard` (parent UI) — but wait, the kid shouldn't be under the parent's family anymore. This needs a design decision: does the graduated kid become a separate BudgetWise account, or stay linked as an adult family member?
  - **Recommendation:** separate account. Family members stay visible in the parent's Members page as "graduated — {date}" but data is isolated. The kid can re-link as an adult family member if both consent (out of scope for v1).

**Verify:** Kid born 2008-04-25 (turns 18 tomorrow relative to today) sees banner on next login. Kid already 18+ sees wizard.

---

## Task 8: Membership page — per-kid age + bracket display

**File:** `src/pages/MembersPage.tsx`

- [ ] Each kid card shows age (derived from DOB) and bracket label ("7-9", "10-12", etc.)
- [ ] Birthday chip if within 30 days
- [ ] "Graduated" status if `role = 'graduated_adult'`

---

## Task 9: Regression tests

Manual:
- [ ] Existing kid (pre-Phase-6) with `age` but null DOB → sees backfill banner → adds DOB → banner disappears
- [ ] New kid age 8 → only bracket 7-9 missions visible
- [ ] New kid age 17 → bracket 16-17 missions visible + graduation banner if within 30 days of 18
- [ ] Sign-in-switching via Kids dropdown (PR #7) between two kids in different brackets → visuals update, missions filter updates
- [ ] Constraint blocks inserting a mission with `age_min > age_max`

Automated (Playwright, add to `scripts/screenshots.mjs`):
- [ ] Screenshot one JuniorHomePage per bracket and diff against baseline

---

## Task 10: Memory + docs

- [ ] Update `~/.claude/projects/-Users-kevinsmac/memory/budgetwise.md` — Phase 6 shipped, age system live, graduation flow description
- [ ] Add short entry to `store-assets/BudgetWise_Junior_for_Parents.md` — "Age-appropriate lessons" bullet
- [ ] SW cache bump v10 → v11

---

## Rollout order (summary)

Schema → kids have DOB → missions filter by age → content per bracket → visuals per bracket → graduation flow → Members page polish → tests → docs.

**Total estimated effort (after user signs off on D1–D7):**
- T1 (schema): 30 min
- T2 (AddKidModal DOB): 45 min
- T3 (backfill banner): 1h
- T4 (hook filter): 20 min
- T5 (content): **~8h authoring + 2h migration scripting** (this is the expensive part)
- T6 (visuals): 2h
- T7 (graduation): 3h including edge function
- T8 (MembersPage): 30 min
- T9 (tests): 1h
- T10 (docs): 30 min

**Roughly 2 dev days, gated by content-authoring throughput.**

---

## Non-goals (explicitly deferred to later phases)

- Content in languages other than English — Phase 7 candidate
- Parent-authored custom missions — Phase 7 candidate
- Mission-reward payout distribution actually splits across save/spend/give jars — the jar split column exists but settle-up doesn't honor it yet; tracked separately
- Push notifications per-bracket (e.g. bedtime-friendly hours for younger kids) — Phase 7
- COPPA / PoPIA compliance review for under-13 users — pre-launch legal task, not in-phase

---

## Risks

1. **Content-authoring bottleneck.** 20 missions of 5-step educational content is the hardest part of this phase. If the user wants me to draft the content I can, but it should be reviewed before going live — kid-facing educational content that's wrong is worse than no content.
2. **Third-party licensed content** (Khan Academy specifically flagged): most "free" educational content online is actually CC-BY-NC-SA (non-commercial) or similarly restricted. BudgetWise has a paid Pro tier. Adapting NC-licensed content for the product is a licence violation. **Default to original content unless a licence has been explicitly reviewed.** Public-domain government content (US gov, and to a lesser extent some SA gov bulletins) is safe.
2. **Graduation is one-way.** A kid who graduates and later wants to re-join the family account is a v2 problem. Make the graduation confirmation dialog explicit about this.
3. **PoPIA under-13.** SA law requires parental consent for processing kids' PII under 13. We're already collecting that consent implicitly (parent creates the account), but a formal consent checkbox in AddKidModal would be prudent. Add as T0.5 if a lawyer says so.
4. **Existing `age` column fate.** After T3 backfill completes, `family_members.age` becomes redundant and stale. Either drop it in a later migration or leave it and ignore — safer to leave for now, drop in Phase 7.
