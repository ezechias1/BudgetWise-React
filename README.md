# BudgetWise

A budgeting app built for South Africa. Track expenses, run savings goals and
stokvels, cost out load shedding, and hand kids their own money-learning app —
all on one Supabase backend.

React 18 + TypeScript + Vite, deployed as a PWA and wrapped for Android with
Capacitor. This repo is the React port of the original vanilla-JS BudgetWise;
several modules still carry comments pointing back to their `js/app.js` line
numbers.

**Production:** https://budget-wise-react.vercel.app
(`npm run deploy` also aliases it to `budget-wise-ruby.vercel.app`, the old
vanilla site's URL)

## Quick start

```bash
npm install
# create .env.local with the variables below
npm run dev                  # http://localhost:5173
```

### Environment

The app throws on boot without the first two — see `src/lib/supabase.ts`.

| Variable | Required | Used by |
|---|---|---|
| `VITE_SUPABASE_URL` | yes | Supabase client |
| `VITE_SUPABASE_ANON_KEY` | yes | Supabase client |
| `VITE_ADMIN_EMAILS` | no | comma-separated list; unlocks `/dashboard/admin` (`src/lib/access.ts`) |
| `VITE_VAPID_PUBLIC_KEY` | no | Web Push subscription for Junior reminders |

Edge functions read their own secrets from the Supabase project, not from
`.env.local`: `ANTHROPIC_API_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`,
`VAPID_SUBJECT`, `APP_URL`, `CRON_INVOKE_SECRET`, and the Stitch set
(`STITCH_CLIENT_ID`, `STITCH_PRIVATE_KEY`, `STITCH_REDIRECT_URI`,
`STITCH_STATE_SECRET`, `STITCH_WEBHOOK_SECRET`).

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Vite dev server on port 5173, exposed on the LAN (`host: true`) |
| `npm run build` | `tsc -b` then `vite build` → `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run preview` | serve the production build locally |
| `npm run deploy` | `vercel --prod` + the alias swap |
| `node scripts/test-junior-age.mjs` | sanity check for the age-bracket helpers |
| `node scripts/screenshots.mjs` | Playwright store screenshots (needs `BUDGETWISE_EMAIL` / `BUDGETWISE_PASSWORD`) |

There is no test runner. The two scripts above are hand-rolled and run
directly with `node`.

## Layout

```
src/
  App.tsx           router + provider tree (Theme → Mode → Auth)
  pages/            one file per route; all lazy-loaded
  pages/junior/     the kid-facing app
  components/       shared UI, modals, layout shells
  hooks/            one hook per data concern (useExpenses, useTrips, …)
  contexts/         Auth, Mode, Theme
  lib/              non-React logic: supabase client, OCR, exports, access
  i18n/junior/      Junior translations
  styles-*.css      plain CSS, carried over from the vanilla app
supabase/
  migrations/       schema + RLS, applied in filename order
  functions/        Deno edge functions
docs/               audit notes and design specs
store-assets/       Play Store listing, screenshots, marketing copy
android/            Capacitor Android project (appId com.budgetwise.app)
```

Imports use the `@/` alias for `src/` (see `vite.config.ts` and
`tsconfig.json`).

## Workspaces

`ModeContext` owns the current workspace and mirrors it onto a `<body>`
class, which is how the CSS switches skins. Three exist:

- **Personal** — overview, expenses, savings, currency, advice, bank,
  stokvel, load shedding.
- **Family** — members, allowances, chores, family goals, shared spending
  tracker, and the parent-side Junior dashboard.
- **Business** — invoices, clients, P&L, tax, partners. **Currently closed.**

Business is gated by `BUSINESS_MODE_ENABLED` in `src/lib/features.ts`. While
it is `false` the mode picker and sidebar entry are disabled with a "Coming
Soon" badge, `ModeContext` refuses to enter the mode even if an old session
left `bw-mode=business` in localStorage, and the routes redirect to
`/dashboard`. Nothing is deleted — flip the flag and every business surface
returns.

## Junior

A separate kid-facing app under `/junior`, with its own layout, language
provider and PIN login. Kids get chores, missions, savings jars, goals, and
money requests to a parent; parents create and manage kid accounts from the
Family workspace. Missions are seeded per age bracket (7–9, 10–12, 13–15,
16–17) by the `supabase/migrations/*missions_bracket*` files.

`src/i18n/junior/` covers English, Afrikaans and isiZulu. The other eight
official SA languages are listed in `languages.ts` with `translated: false`
so the picker can show them as "coming soon" while falling back to English.

## Notable features

- **Receipt scanning** — `src/lib/receipt-scan.ts` downscales and greyscales
  the photo on a canvas, then lazy-imports tesseract.js (the ~4 MB worker is
  only fetched on first scan) and parses the OCR text into amount /
  description / date for review in an `ExpenseModal`.
- **BudgetSmart** — the `budgetsmart` edge function streams financial advice
  from the Anthropic API, with a per-user daily usage limit enforced in the
  database (`20260818142526_budgetsmart_daily_usage_limit.sql`).
- **Bank linking** — Stitch OAuth, webhook and transaction sync live in
  `supabase/functions/stitch-*`. The UI is gated behind
  `BANK_CONNECT_ENABLED` in `BankPage.tsx`, currently `false`.
- **Stokvel** — group savings with membership checks, approval and payout
  integrity enforced at the database level.
- **Load shedding** — logs generator fuel, UPS/inverter and related costs as
  their own expense sub-categories.
- **Trips** — auto-tags expenses to a trip and prompts for review afterwards.
- **Currency** — live rates from exchangerate-api.com, cached per base for
  the page lifetime (`useExchangeRates`).
- **Export / import** — CSV and print-ready PDF out, CSV in.
- **Charts** — Chart.js via react-chartjs-2, themed centrally in
  `lib/chartTheme.ts` and registered once in `lib/chartRegistry.ts`.

## Access control

`src/lib/access.ts` resolves who sees what:

- `ENABLE_PRO_SYSTEM` is `false`, so **everyone is effectively Pro** right
  now. `isProUser()` still reads `user_settings.is_pro` when it's turned back
  on, and admins bypass it either way.
- `isAdmin()` is an exact-match check against `VITE_ADMIN_EMAILS`. The Admin
  nav item and `/dashboard/admin` are hidden from everyone else.
- `AuthRoleGate` splits parent and child sessions; a kid user is one whose
  `auth_user_id` matches a `family_members` row, which has to be asked of the
  database rather than read from the JWT.

Route-level gates are duplicated on the routes themselves, not just on the
nav links — a typed or bookmarked URL reaches a route regardless of what the
sidebar shows.

## Database

Schema lives entirely in `supabase/migrations/`, applied in filename order,
with row-level security on every table. Edge functions:

| Function | Purpose |
|---|---|
| `budgetsmart` | streams AI financial advice |
| `create-kid-user` / `delete-kid-user` / `reset-kid-pin` | kid account lifecycle |
| `kid-pro-status` | resolves a kid's Pro status from their parent |
| `purge-account` | full account deletion |
| `send-junior-push` / `send-expense-review-push` | Web Push notifications |
| `stitch-link-initiate` / `stitch-oauth-callback` / `stitch-sync-transactions` / `stitch-webhook` | bank linking |

## PWA and deploys

`public/sw.js` is registered in production only, and `index.html` carries a
one-time migration that unregisters the old vanilla service worker and clears
its caches before the React shell loads — visitors who used the vanilla site
had `budgetwise-v34` intercepting requests.

Every page is lazy-loaded through `lazyWithRetry` in `App.tsx`. When a deploy
lands while a tab is open, that tab's stale `index.html` points at chunk
hashes Vercel has already purged; the wrapper catches that specific error,
clears caches, unregisters the service worker and reloads once, guarded by a
session-storage flag so a genuinely missing chunk can't loop.

Vercel builds with the settings in `vercel.json` (Vite, `dist/`, SPA
rewrite). Pushes to `main` deploy automatically.

## Android

`capacitor.config.ts` wraps the built `dist/` as `com.budgetwise.app`. The
Gradle project is committed under `android/`. `store-assets/twa-setup.md`
covers the Trusted Web Activity route as an alternative to Capacitor.

## Docs

- `docs/audit/AUDIT.md` — audit notes
- `docs/superpowers/specs/` — design specs, including the Junior design
- `docs/superpowers/plans/` — phased implementation plans
- `store-assets/store-listing.txt`, `marketing.md` — store and marketing copy
