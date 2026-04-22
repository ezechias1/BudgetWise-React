# BudgetWise Junior — Phase 3: Missions & Jars

> **For agentic workers:** Execute via superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Kids can complete daily money lessons and earn rewards; jars become a meaningful allocation surface; streaks start tracking engagement.

**Architecture:** Build on Phase 1 (auth/routing) and Phase 2 (ledger + chores). Mission completion writes `kid_mission_progress` (kid-side, no reward column per Phase 3 prep migration); a DB trigger inserts a `kid_ledger` row using the parent's configured reward from `kid_mission_rewards`. Jar split lives on `family_members.jar_split` and is edited from a kid-side screen. Streaks increment on any qualifying daily activity.

**Tech:** Same stack. One new client lib: none. No new deps.

**Repo:** `~/Desktop/BudgetWise-React/`, branch `junior-phase-3` (off `main` after PR #3 merge).

**Phase 2 plan:** `docs/superpowers/plans/2026-04-22-budgetwise-junior-phase-2-earn-and-settle.md` — read for patterns + hook/context shapes.

---

## Pre-flight

- [ ] **P0.1:** `git status` clean, `npm run typecheck` green, dev server starts.
- [ ] **P0.2:** Confirm task #26 migration (`20260422000004_tighten_mission_progress_rls.sql`) is applied: `npx supabase@2.93.0 db query --linked "select policyname from pg_policies where tablename='kid_mission_progress';"` must show three `child …` policies (reads / inserts / updates) + one `parent manages own children progress`.

---

## Task 1: Seed 12 missions

**Files:**
- Create: `supabase/migrations/20260422000005_seed_kid_missions.sql`

Replaces the single seeded mission from Phase 1 with a full set of 12. Uses `on conflict (slug) do update set ...` so re-runs refresh the body without creating duplicates.

- [ ] **1.1** Create the migration file with 12 mission rows, one per unit of the design spec. Each row has `slug, unit, title, ord, age_min=10, age_max=13, body jsonb` where body is:

```json
{
  "steps": [
    {"type":"hook","title":"…","body":"…"},
    {"type":"concept","title":"…","body":"…"},
    {"type":"quiz","question":"…","options":["a","b","c"],"answer":0},
    {"type":"tie_in","body":"…"},
    {"type":"done","body":"…"}
  ]
}
```

Slug list (4 units × 3 missions):

Earning unit:
- `effort-vs-time` — *"Why does the dentist charge more than the babysitter?"*
- `one-rand-one-minute` — *"Your time has a price"*
- `tried-failed-learned` — *"Paid to learn: failing fast"*

Saving unit:
- `what-is-saving` — already seeded in Phase 1 ("A jar that waits grows")
- `compound-starter` — *"What if R10 grew by itself?"*
- `rainy-day` — *"Why grownups keep an emergency jar"*

Spending unit:
- `needs-vs-wants` — *"Is it air or is it candy?"*
- `is-it-worth-it` — *"The 3-question test before you buy"*
- `buyer-remorse` — *"Zoë's R50 candy lesson"*

Giving unit:
- `why-give` — *"Giving is not losing"*
- `pick-a-cause` — *"Where should your Give jar go?"*
- `small-gifts-big-impact` — *"R1 to the right place"*

All 12 full bodies below (the engineer pastes verbatim into the SQL `values (...)` list):

```sql
-- BudgetWise Junior — seed all 12 missions (Phase 3 kickoff).
-- Upsert so re-runs refresh content. Keeps slug as the primary dedup key.

insert into kid_missions (slug, unit, title, ord, body) values
  ('what-is-saving', 'Saving', 'What does it mean to save?', 1, $BODY$
  {"steps":[
    {"type":"hook","title":"Zoë's R100","body":"Zoë got R100 from her gran. Watch what happens when she spends it all on sweets vs splits it into jars."},
    {"type":"concept","title":"A jar that waits grows","body":"A jar that waits grows. A jar that rushes empties."},
    {"type":"quiz","question":"Which jar gets bigger over time?","options":["The Save jar","The Spend jar","The Give jar"],"answer":0},
    {"type":"tie_in","body":"If you saved half of what you earn this week, your goal would be closer."},
    {"type":"done","body":"Mission done! Your first lesson is complete."}
  ]}
  $BODY$::jsonb),
  ('effort-vs-time', 'Earning', 'Why some jobs pay more', 2, $BODY$
  {"steps":[
    {"type":"hook","title":"A dentist vs a babysitter","body":"A dentist earns about R500 an hour. A babysitter earns about R60 an hour. Why?"},
    {"type":"concept","title":"Harder, riskier, rarer = more money","body":"Jobs that need years of school, or only a few people can do, or are risky, usually pay more per hour. It's not that one person 'deserves' more — it's that fewer people can do it."},
    {"type":"quiz","question":"Which of these probably earns the most per hour?","options":["A pilot","A dog-walker","A cashier"],"answer":0},
    {"type":"tie_in","body":"The skills you build as a kid (like learning to save money) are tools you'll use later to earn more per hour."},
    {"type":"done","body":"Got it. Knowing WHY things pay different amounts helps you pick what to learn."}
  ]}
  $BODY$::jsonb),
  ('one-rand-one-minute', 'Earning', 'Your time has a price', 3, $BODY$
  {"steps":[
    {"type":"hook","title":"How much is an hour of YOU?","body":"If I paid you R10 to wash the dishes for 15 minutes, that's R40 per hour. What would you charge for an hour of your time?"},
    {"type":"concept","title":"Time is money","body":"When you do a chore for a reward, you're selling your time. The fair price depends on how hard, long, and skilled the work is."},
    {"type":"quiz","question":"Wash 10 cars for R50 in 2 hours. What's your rate per hour?","options":["R5","R25","R250"],"answer":1},
    {"type":"tie_in","body":"Next time your parent offers you a chore, decide: is the reward worth the time?"},
    {"type":"done","body":"You now think like a worker AND a boss."}
  ]}
  $BODY$::jsonb),
  ('tried-failed-learned', 'Earning', 'Paid to learn', 4, $BODY$
  {"steps":[
    {"type":"hook","title":"When getting it wrong is the lesson","body":"Sarah tried to sell lemonade for R50 a glass. Nobody bought any. She dropped the price to R10. All 20 glasses sold."},
    {"type":"concept","title":"Trying and failing teaches you more than not trying","body":"The people who earn the most money are usually the ones who failed the most times and kept going."},
    {"type":"quiz","question":"Sarah's lemonade failure taught her…","options":["To give up","The right price","Lemonade is bad"],"answer":1},
    {"type":"tie_in","body":"Even finishing this quiz and getting it wrong means you learned. That's worth real money over time."},
    {"type":"done","body":"Failing fast is earning, slowly."}
  ]}
  $BODY$::jsonb),
  ('compound-starter', 'Saving', 'Your money can grow by itself', 5, $BODY$
  {"steps":[
    {"type":"hook","title":"R10 today, R10.50 tomorrow","body":"If you put R10 in a jar that grows 5% each year, after 1 year you have R10.50. No extra work — the jar gave you the 50c."},
    {"type":"concept","title":"Interest — money earning money","body":"Banks pay you for leaving your money with them. It's small at first, but over many years the growth stacks on itself. This is called compound interest."},
    {"type":"quiz","question":"If R100 grows by 10% each year, how much after 2 years?","options":["R110","R121","R120"],"answer":1},
    {"type":"tie_in","body":"Starting young matters. R100 now could become R1,000+ by the time you're an adult."},
    {"type":"done","body":"Money that sleeps in a jar can still work for you."}
  ]}
  $BODY$::jsonb),
  ('rainy-day', 'Saving', 'The rainy-day jar', 6, $BODY$
  {"steps":[
    {"type":"hook","title":"What if your phone breaks?","body":"Thandi's phone screen cracked. Fixing it was R400. Because she'd been saving R20 a week for 5 months, she had R400 in her rainy-day jar."},
    {"type":"concept","title":"Emergency money stops small problems from becoming big ones","body":"Grownups call this an emergency fund. Having even a small one means you don't have to borrow or panic when something breaks."},
    {"type":"quiz","question":"What's a rainy-day jar for?","options":["Candy","Unexpected problems","Christmas gifts"],"answer":1},
    {"type":"tie_in","body":"Try to keep at least R50 in your Save jar that you promise yourself not to touch — that's your rainy day."},
    {"type":"done","body":"Rainy days come. You don't have to be caught in them."}
  ]}
  $BODY$::jsonb),
  ('needs-vs-wants', 'Spending', 'Is it air or candy?', 7, $BODY$
  {"steps":[
    {"type":"hook","title":"Two shopping lists","body":"Ama and Jabu each got R100. Ama spent all of hers on sweets. Jabu spent R50 on a book and R50 on sweets. A week later, Ama has 0. Jabu has a book."},
    {"type":"concept","title":"Needs keep you alive. Wants make you smile.","body":"Food, shelter, school supplies — those are needs. Candy, games, shoes you don't need — those are wants. Both are OK! The trick is knowing which is which."},
    {"type":"quiz","question":"Which of these is a NEED?","options":["New sneakers when yours still fit","Food for dinner","A second gaming console"],"answer":1},
    {"type":"tie_in","body":"Next time you want to buy something, ask: is this air (I'll die without it) or candy (I'd like it)? Both are fine; just know which."},
    {"type":"done","body":"Knowing needs vs wants is a superpower."}
  ]}
  $BODY$::jsonb),
  ('is-it-worth-it', 'Spending', 'The 3-question test', 8, $BODY$
  {"steps":[
    {"type":"hook","title":"Before you swipe","body":"Kgomotso was about to buy a R200 toy. Then she asked herself three questions. She put the toy back."},
    {"type":"concept","title":"The three questions","body":"Before any purchase, ask: (1) Will I still want this in a week? (2) Can I get it cheaper somewhere else? (3) Do I already have something like this?"},
    {"type":"quiz","question":"Which question helps the most?","options":["Will I still want it in a week?","Is it on sale?","Is it shiny?"],"answer":0},
    {"type":"tie_in","body":"Try it on the next thing you want. If 2 out of 3 answers say 'no' — skip it this time."},
    {"type":"done","body":"You now have a tool grownups wish they had."}
  ]}
  $BODY$::jsonb),
  ('buyer-remorse', 'Spending', 'The R50 candy lesson', 9, $BODY$
  {"steps":[
    {"type":"hook","title":"Zoë's sad Wednesday","body":"Zoë spent her whole week's allowance on R50 of sweets on Monday. By Wednesday, the sweets were gone. On Thursday she saw a book she really wanted — but had no money."},
    {"type":"concept","title":"Buyer's remorse","body":"The bad feeling AFTER you buy something is called buyer's remorse. It usually hits when you spent money you wish you had for something else."},
    {"type":"quiz","question":"What could Zoë have done to avoid this?","options":["Not save","Spread her money across the week","Ask for more allowance"],"answer":1},
    {"type":"tie_in","body":"Keep a small record of things you buy and don't need. Next time the urge hits, remember how the last one felt."},
    {"type":"done","body":"The best purchase is the one you're still happy about next week."}
  ]}
  $BODY$::jsonb),
  ('why-give', 'Giving', 'Giving is not losing', 10, $BODY$
  {"steps":[
    {"type":"hook","title":"R10 that changed a week","body":"Lethabo gave R10 to a kid on her street who hadn't eaten that day. The kid smiled for the first time all week. Lethabo still had R190 in her Save jar."},
    {"type":"concept","title":"Giving makes you richer, not poorer","body":"Research says people who give regularly feel happier, have better friendships, and actually save more money too. Giving isn't about having less — it's about building a world you want to live in."},
    {"type":"quiz","question":"Why do people who give often ALSO save more?","options":["It's a coincidence","They think about money more clearly","They feel guilty"],"answer":1},
    {"type":"tie_in","body":"Your Give jar doesn't have to be big. Even R2 a week to one cause adds up and trains the habit."},
    {"type":"done","body":"Giving is the secret third winner."}
  ]}
  $BODY$::jsonb),
  ('pick-a-cause', 'Giving', 'Where should your Give jar go?', 11, $BODY$
  {"steps":[
    {"type":"hook","title":"Three families, three causes","body":"The Naidoos give to animal shelters. The Bhayats feed street dogs. The Marais family gives to their school's extra-meals program. All are right."},
    {"type":"concept","title":"Give to something YOU care about","body":"You'll give more, and keep giving, if you believe in the cause. Animals, food, kids, environment, faith — whatever makes you feel 'this matters'."},
    {"type":"quiz","question":"What's the best cause?","options":["The biggest one","The one YOU believe in","The one nobody else supports"],"answer":1},
    {"type":"tie_in","body":"Write down one cause you care about. Next time you settle up, imagine your Give jar going there."},
    {"type":"done","body":"Your cause, your call."}
  ]}
  $BODY$::jsonb),
  ('small-gifts-big-impact', 'Giving', 'R1 to the right place', 12, $BODY$
  {"steps":[
    {"type":"hook","title":"One rand, 3,000 people","body":"If everyone in your school gave R1 to a food charity once, that's about R3,000. Enough to feed 300 hungry kids for a day."},
    {"type":"concept","title":"Small on their own, huge together","body":"You don't have to be rich to matter. Small regular gifts from many people change more than one big gift from one rich person."},
    {"type":"quiz","question":"Which impacts more?","options":["1 person gives R1,000 once","1,000 people give R1 each month","Neither"],"answer":1},
    {"type":"tie_in","body":"When you settle up, even R2 in the Give jar is part of something bigger."},
    {"type":"done","body":"Small + steady = enormous."}
  ]}
  $BODY$::jsonb)
on conflict (slug) do update set
  unit = excluded.unit,
  title = excluded.title,
  ord = excluded.ord,
  body = excluded.body;
```

- [ ] **1.2** Apply: `npx supabase@2.93.0 db push --include-all`. Expected: 1 migration applied.
- [ ] **1.3** Verify: `npx supabase@2.93.0 db query --linked "select count(*) from kid_missions;"` must return 12.
- [ ] **1.4** Commit: `feat(junior): seed 12 missions across 4 units`.

---

## Task 2: DB trigger — mission completion writes kid_ledger

**Files:**
- Create: `supabase/migrations/20260422000006_mission_reward_trigger.sql`

When `kid_mission_progress.status` flips to `'completed'`, the trigger (runs as `security definer`) reads the parent's configured reward from `kid_mission_rewards` and inserts a `kid_ledger` row with `status='owed'`. Uses `family_members.user_id` to derive the parent's auth user id.

- [ ] **2.1** Write the migration exactly as below:

```sql
-- BudgetWise Junior — award ledger on mission completion

create or replace function kid_mission_reward_on_complete()
returns trigger as $$
declare
  parent_user_id uuid;
  reward_cents integer;
  mission_title text;
begin
  if new.status = 'completed' and (old is null or old.status is null or old.status != 'completed') then
    select user_id into parent_user_id from family_members where id = new.member_id;
    if parent_user_id is null then
      return new;
    end if;
    select coalesce(reward_amount_cents, 0) into reward_cents
      from kid_mission_rewards
      where user_id = parent_user_id and mission_id = new.mission_id;
    reward_cents := coalesce(reward_cents, 0);
    if reward_cents > 0 then
      select title into mission_title from kid_missions where id = new.mission_id;
      insert into kid_ledger (user_id, member_id, amount_cents, source_type, source_id, status, notes)
      values (
        parent_user_id, new.member_id, reward_cents,
        'lesson', new.mission_id, 'owed',
        'Mission: ' || coalesce(mission_title, 'unknown')
      );
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists kid_mission_progress_reward on kid_mission_progress;
create trigger kid_mission_progress_reward
  after insert or update on kid_mission_progress
  for each row execute function kid_mission_reward_on_complete();
```

- [ ] **2.2** Apply + verify: `npx supabase@2.93.0 db query --linked "select tgname from pg_trigger where tgrelid = 'public.kid_mission_progress'::regclass and not tgisinternal;"` must show `kid_mission_progress_reward`.
- [ ] **2.3** Commit: `feat(junior): trigger inserts kid_ledger on mission completion`.

---

## Task 3: useKidMissions hook + JuniorMissionsPage

**Files:**
- Create: `src/hooks/useKidMissions.ts`
- Create: `src/pages/junior/JuniorMissionsPage.tsx`
- Modify: `src/App.tsx` (lazy import + `/junior/missions` route)

Hook returns `{ missions, progressByMission, loading, error, refresh }` where `missions` is the seeded list (filtered by `age_min <= kidAge <= age_max`) and `progressByMission` is a `Record<mission_id, KidMissionProgress>` so the list can mark each as locked / available / completed.

- [ ] **3.1** Create `src/hooks/useKidMissions.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export interface KidMission {
  id: string;
  slug: string;
  unit: string;
  title: string;
  ord: number;
  body: { steps: Array<{ type: string; [key: string]: unknown }> };
}

export interface KidMissionProgress {
  id: string;
  mission_id: string;
  status: 'locked' | 'available' | 'completed';
  completed_at: string | null;
  quiz_score: number | null;
}

interface State {
  missions: KidMission[];
  progressByMission: Record<string, KidMissionProgress>;
  loading: boolean;
  error: string | null;
}

export function useKidMissions(memberId: string | null) {
  const [state, setState] = useState<State>({
    missions: [],
    progressByMission: {},
    loading: true,
    error: null,
  });

  const refresh = useCallback(async () => {
    if (!memberId) {
      setState({ missions: [], progressByMission: {}, loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    const [mRes, pRes] = await Promise.all([
      supabase.from('kid_missions').select('*').order('ord'),
      supabase
        .from('kid_mission_progress')
        .select('id, mission_id, status, completed_at, quiz_score')
        .eq('member_id', memberId),
    ]);
    if (mRes.error) {
      setState((s) => ({ ...s, loading: false, error: mRes.error!.message }));
      return;
    }
    const missions = (mRes.data as KidMission[]) ?? [];
    const rows = (pRes.data as KidMissionProgress[]) ?? [];
    const progressByMission: Record<string, KidMissionProgress> = {};
    for (const r of rows) progressByMission[r.mission_id] = r;
    setState({ missions, progressByMission, loading: false, error: null });
  }, [memberId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ...state, refresh };
}
```

- [ ] **3.2** Create `src/pages/junior/JuniorMissionsPage.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { useKidProfile } from '@/hooks/useKidProfile';
import { useKidMissions } from '@/hooks/useKidMissions';

export default function JuniorMissionsPage() {
  const { member, loading: profileLoading } = useKidProfile();
  const { missions, progressByMission, loading } = useKidMissions(member?.id ?? null);

  if (profileLoading || loading) return <p>Loading missions…</p>;
  if (!member) return <p>Couldn&apos;t load your profile.</p>;

  const byUnit: Record<string, typeof missions> = {};
  for (const m of missions) {
    if (!byUnit[m.unit]) byUnit[m.unit] = [];
    byUnit[m.unit].push(m);
  }

  return (
    <>
      <section className="junior-hero" style={{ marginBottom: 20 }}>
        <h1>Missions</h1>
        <p>Short money lessons. Finish a mission, earn a reward.</p>
      </section>

      {Object.entries(byUnit).map(([unit, unitMissions]) => (
        <section key={unit} style={{ marginBottom: 24 }}>
          <h3>{unit}</h3>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {unitMissions.map((m) => {
              const p = progressByMission[m.id];
              const done = p?.status === 'completed';
              return (
                <li key={m.id} style={{ margin: '8px 0' }}>
                  <Link
                    to={`/junior/mission/${m.id}`}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      background: done ? 'rgba(16,185,129,0.1)' : 'white',
                      borderRadius: 12,
                      padding: '14px 16px',
                      textDecoration: 'none',
                      color: 'inherit',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.05)',
                    }}
                  >
                    <div>
                      <strong>{m.title}</strong>
                      {done && <small style={{ marginLeft: 8, color: '#10b981' }}>Done</small>}
                    </div>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
```

- [ ] **3.3** Wire route in `src/App.tsx`. Alongside other junior lazy imports:

```tsx
const JuniorMissionsPage = lazy(() => import('@/pages/junior/JuniorMissionsPage'));
const JuniorMissionPlayer = lazy(() => import('@/pages/junior/JuniorMissionPlayer'));  // used in Task 4
```

Inside the `/junior` gated block, alongside `<Route path="home" ...>` and `<Route path="chores" ...>`:

```tsx
              <Route path="missions" element={<JuniorMissionsPage />} />
              <Route path="mission/:id" element={<JuniorMissionPlayer />} />
```

(The second route points at a component Task 4 creates — typecheck will have one missing-module error until T4 lands, matching the Phase 1 pattern.)

- [ ] **3.4** Typecheck — expected: one missing-module error for `JuniorMissionPlayer`. OK to commit.
- [ ] **3.5** Commit: `feat(junior): missions list page + useKidMissions hook`.

---

## Task 4: JuniorMissionPlayer — the 5-step flow

**Files:**
- Create: `src/pages/junior/JuniorMissionPlayer.tsx`

Reads `/junior/mission/:id` param, loads that one mission's body, renders step-by-step. On completion, inserts `kid_mission_progress { status:'completed', completed_at, quiz_score }`. The DB trigger from Task 2 writes the ledger row automatically.

- [ ] **4.1** Create the player file:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useKidProfile } from '@/hooks/useKidProfile';
import { type KidMission } from '@/hooks/useKidMissions';

interface HookStep { type: 'hook'; title: string; body: string; }
interface ConceptStep { type: 'concept'; title: string; body: string; }
interface QuizStep { type: 'quiz'; question: string; options: string[]; answer: number; }
interface TieInStep { type: 'tie_in'; body: string; }
interface DoneStep { type: 'done'; body: string; }
type MissionStep = HookStep | ConceptStep | QuizStep | TieInStep | DoneStep;

export default function JuniorMissionPlayer() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { member } = useKidProfile();
  const [mission, setMission] = useState<KidMission | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [quizPick, setQuizPick] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from('kid_missions')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (cancelled) return;
      if (err) setError(err.message);
      else setMission(data as KidMission | null);
    })();
    return () => { cancelled = true; };
  }, [id]);

  const completeMission = useCallback(async (quizScore: number | null) => {
    if (!member || !mission) return;
    setSubmitting(true);
    setError(null);
    const completedAt = new Date().toISOString();
    // Upsert progress row. The DB trigger writes the kid_ledger reward.
    const { error: err } = await supabase
      .from('kid_mission_progress')
      .upsert(
        {
          member_id: member.id,
          mission_id: mission.id,
          status: 'completed',
          completed_at: completedAt,
          quiz_score: quizScore,
        },
        { onConflict: 'member_id,mission_id' },
      );
    setSubmitting(false);
    if (err) {
      setError(err.message);
      return;
    }
    // Proceed to the done step
    setStepIdx((i) => i + 1);
  }, [member, mission]);

  if (error) return <p style={{ color: '#dc2626' }}>Couldn&apos;t load mission: {error}</p>;
  if (!mission) return <p>Loading…</p>;

  const steps = (mission.body.steps ?? []) as MissionStep[];
  const step = steps[stepIdx];
  if (!step) return <p>Mission empty.</p>;

  const advance = async () => {
    if (step.type === 'tie_in') {
      // Before showing 'done', write completion to DB so trigger fires the ledger
      await completeMission(quizPick === (steps.find((s): s is QuizStep => s.type === 'quiz')?.answer ?? -1) ? 100 : 0);
      return;
    }
    setStepIdx((i) => i + 1);
  };

  return (
    <>
      <section className="junior-hero" style={{ marginBottom: 20 }}>
        <h1>{mission.title}</h1>
        <p>Step {stepIdx + 1} of {steps.length}</p>
      </section>

      <div style={{ background: 'white', borderRadius: 16, padding: 24, boxShadow: '0 2px 6px rgba(0,0,0,0.06)' }}>
        {step.type === 'hook' && (
          <>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </>
        )}
        {step.type === 'concept' && (
          <>
            <h3>{step.title}</h3>
            <p style={{ fontSize: '1.1rem' }}>{step.body}</p>
          </>
        )}
        {step.type === 'quiz' && (
          <>
            <h3>{step.question}</h3>
            <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
              {step.options.map((opt, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setQuizPick(i)}
                  style={{
                    padding: 12,
                    borderRadius: 10,
                    border: quizPick === i ? '2px solid #10b981' : '1px solid #ddd',
                    background: quizPick === i ? 'rgba(16,185,129,0.1)' : 'white',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  {opt}
                </button>
              ))}
            </div>
            {quizPick != null && (
              <p style={{ marginTop: 12, color: quizPick === step.answer ? '#10b981' : '#dc2626' }}>
                {quizPick === step.answer ? 'Correct!' : 'Not quite — think about which one grows.'}
              </p>
            )}
          </>
        )}
        {step.type === 'tie_in' && <p style={{ fontSize: '1.1rem', fontStyle: 'italic' }}>{step.body}</p>}
        {step.type === 'done' && (
          <>
            <h3>Mission complete!</h3>
            <p>{step.body}</p>
            <button
              type="button"
              onClick={() => navigate('/junior/missions')}
              className="btn-primary"
              style={{ marginTop: 16 }}
            >
              Back to missions
            </button>
          </>
        )}
      </div>

      {step.type !== 'done' && (
        <button
          type="button"
          onClick={advance}
          disabled={submitting || (step.type === 'quiz' && quizPick == null)}
          className="btn-primary"
          style={{ marginTop: 16, width: '100%' }}
        >
          {submitting ? 'Saving…' : step.type === 'tie_in' ? 'Finish' : 'Next'}
        </button>
      )}
    </>
  );
}
```

- [ ] **4.2** Typecheck: must be clean.
- [ ] **4.3** Commit: `feat(junior): mission player (hook → concept → quiz → tie-in → done)`.

---

## Task 5: Parent mission-rewards config UI

**Files:**
- Modify: `src/pages/JuniorDashboardPage.tsx` — add a "Configure mission rewards" section.
- Create: `src/components/MissionRewardsModal.tsx`

Parent opens modal from Junior dashboard. Modal lists all 12 seeded missions; for each, an input for R-amount. Saves to `kid_mission_rewards (user_id, mission_id, reward_amount_cents)` via upsert.

- [ ] **5.1** Create `src/components/MissionRewardsModal.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

interface Mission { id: string; title: string; unit: string; }
interface Reward { mission_id: string; reward_amount_cents: number; }

interface Props { onClose: () => void; }

export function MissionRewardsModal({ onClose }: Props) {
  const { user } = useAuth();
  const [missions, setMissions] = useState<Mission[]>([]);
  const [rewards, setRewards] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [mRes, rRes] = await Promise.all([
      supabase.from('kid_missions').select('id, title, unit').order('ord'),
      supabase.from('kid_mission_rewards').select('mission_id, reward_amount_cents').eq('user_id', user.id),
    ]);
    setMissions((mRes.data as Mission[]) ?? []);
    const rewardMap: Record<string, string> = {};
    for (const r of (rRes.data as Reward[]) ?? []) {
      rewardMap[r.mission_id] = (r.reward_amount_cents / 100).toFixed(2);
    }
    setRewards(rewardMap);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    const rows = missions
      .map((m) => ({
        user_id: user.id,
        mission_id: m.id,
        reward_amount_cents: Math.round(parseFloat(rewards[m.id] || '0') * 100),
      }))
      .filter((r) => r.reward_amount_cents >= 0);
    await supabase
      .from('kid_mission_rewards')
      .upsert(rows, { onConflict: 'user_id,mission_id' });
    setSaving(false);
    onClose();
  };

  const byUnit: Record<string, Mission[]> = {};
  for (const m of missions) {
    if (!byUnit[m.unit]) byUnit[m.unit] = [];
    byUnit[m.unit].push(m);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="modal-header">
          <h2>Mission rewards</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <p>Set how much each mission earns when your kid finishes it. Leave at 0 if you don&apos;t want it to pay.</p>
        {loading ? (
          <p>Loading…</p>
        ) : (
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {Object.entries(byUnit).map(([unit, uMissions]) => (
              <div key={unit} style={{ marginBottom: 16 }}>
                <h4 style={{ marginBottom: 8 }}>{unit}</h4>
                {uMissions.map((m) => (
                  <div
                    key={m.id}
                    className="field"
                    style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 12, alignItems: 'center', margin: '6px 0' }}
                  >
                    <label htmlFor={`r-${m.id}`} style={{ margin: 0 }}>{m.title}</label>
                    <input
                      id={`r-${m.id}`}
                      type="number"
                      min={0}
                      step="0.5"
                      placeholder="0.00"
                      value={rewards[m.id] ?? ''}
                      onChange={(e) => setRewards((prev) => ({ ...prev, [m.id]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving…' : 'Save rewards'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **5.2** In `src/pages/JuniorDashboardPage.tsx`, import and add a button above the cards grid:

```tsx
import { MissionRewardsModal } from '@/components/MissionRewardsModal';
// ...inside component:
const [showRewards, setShowRewards] = useState(false);
// ...in JSX, above the kids grid:
<div style={{ marginBottom: 16 }}>
  <button type="button" onClick={() => setShowRewards(true)}>
    Configure mission rewards
  </button>
</div>
// ...at end of JSX:
{showRewards && <MissionRewardsModal onClose={() => setShowRewards(false)} />}
```

- [ ] **5.3** Typecheck + commit: `feat(junior): parent can set rand reward per mission`.

---

## Task 6: Jar split adjust UI (kid-side)

**Files:**
- Create: `src/pages/junior/JuniorJarsPage.tsx`
- Modify: `src/App.tsx` (add route + lazy import)
- Modify: `src/components/junior/JuniorLayout.tsx` (Jars tab in bottom nav)

Kid picks Save / Spend / Give percentages. Must sum to 100. Saves to `family_members.jar_split`.

- [ ] **6.1** Create the page:

```tsx
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useKidProfile } from '@/hooks/useKidProfile';

export default function JuniorJarsPage() {
  const { member, loading: profileLoading } = useKidProfile();
  const [save, setSave] = useState(50);
  const [spend, setSpend] = useState(30);
  const [give, setGive] = useState(20);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (member?.jar_split) {
      setSave(member.jar_split.save);
      setSpend(member.jar_split.spend);
      setGive(member.jar_split.give);
    }
  }, [member]);

  const total = save + spend + give;
  const canSave = total === 100 && !submitting;

  const handleSave = async () => {
    if (!member || !canSave) return;
    setSubmitting(true);
    await supabase
      .from('family_members')
      .update({ jar_split: { save, spend, give } })
      .eq('id', member.id);
    setSubmitting(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (profileLoading || !member) return <p>Loading…</p>;

  const barW = (n: number) => `${(n / 100) * 100}%`;

  return (
    <>
      <section className="junior-hero" style={{ marginBottom: 20 }}>
        <h1>Your jars</h1>
        <p>When your parents pay you, your money splits into these three jars.</p>
      </section>

      <div style={{ background: 'white', borderRadius: 16, padding: 20, marginBottom: 20 }}>
        <div style={{ display: 'flex', height: 20, borderRadius: 6, overflow: 'hidden', marginBottom: 16 }}>
          <div style={{ width: barW(save), background: '#10b981' }} />
          <div style={{ width: barW(spend), background: '#3b82f6' }} />
          <div style={{ width: barW(give), background: '#8b5cf6' }} />
        </div>

        {(['save', 'spend', 'give'] as const).map((jar) => {
          const val = jar === 'save' ? save : jar === 'spend' ? spend : give;
          const set = jar === 'save' ? setSave : jar === 'spend' ? setSpend : setGive;
          return (
            <div key={jar} className="field">
              <label>{jar.charAt(0).toUpperCase() + jar.slice(1)}: {val}%</label>
              <input type="range" min={0} max={100} value={val} onChange={(e) => set(Number(e.target.value))} />
            </div>
          );
        })}

        <p style={{ color: total === 100 ? '#10b981' : '#dc2626' }}>
          Total: {total}% {total !== 100 && '(must be 100)'}
        </p>

        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          className="btn-primary"
          style={{ marginTop: 12, width: '100%' }}
        >
          {saved ? 'Saved!' : submitting ? 'Saving…' : 'Save my split'}
        </button>
      </div>
    </>
  );
}
```

- [ ] **6.2** Route + lazy import in App.tsx:

```tsx
const JuniorJarsPage = lazy(() => import('@/pages/junior/JuniorJarsPage'));
// ...
              <Route path="jars" element={<JuniorJarsPage />} />
```

- [ ] **6.3** Add Jars tab to JuniorLayout (third NavLink). Use an SVG jars/containers icon:

```tsx
        <NavLink to="/junior/jars" className={({ isActive }) => (isActive ? 'active' : '')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="7" width="5" height="14" rx="1" />
            <rect x="10" y="4" width="5" height="17" rx="1" />
            <rect x="17" y="10" width="5" height="11" rx="1" />
          </svg>
          Jars
        </NavLink>
```

- [ ] **6.4** Typecheck + commit: `feat(junior): kid jars page with save/spend/give split`.

---

## Task 7: Streaks auto-update on daily activity

**Files:**
- Create: `supabase/migrations/20260422000007_kid_streak_trigger.sql`

A trigger on `kid_mission_progress` (after insert or update to `completed`) bumps `kid_streaks.current_streak` for that member, using `last_active_date` to decide continue-vs-reset. Upserts a new row if none exists.

- [ ] **7.1** Write the migration:

```sql
-- BudgetWise Junior — streak increment on mission/chore activity

create or replace function kid_streak_on_activity()
returns trigger as $$
declare
  today date := current_date;
  row kid_streaks%rowtype;
  new_current integer;
begin
  -- Only fire when mission newly completes
  if tg_table_name = 'kid_mission_progress' then
    if not (new.status = 'completed' and (old is null or old.status != 'completed')) then
      return new;
    end if;
  end if;

  select * into row from kid_streaks where member_id = new.member_id;
  if not found then
    insert into kid_streaks (member_id, current_streak, longest_streak, last_active_date)
    values (new.member_id, 1, 1, today);
    return new;
  end if;

  if row.last_active_date = today then
    return new;  -- already counted today
  elsif row.last_active_date = today - interval '1 day' then
    new_current := row.current_streak + 1;
  else
    new_current := 1;  -- streak broke
  end if;

  update kid_streaks set
    current_streak = new_current,
    longest_streak = greatest(row.longest_streak, new_current),
    last_active_date = today
  where member_id = new.member_id;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists kid_streak_mission_progress on kid_mission_progress;
create trigger kid_streak_mission_progress
  after insert or update on kid_mission_progress
  for each row execute function kid_streak_on_activity();
```

- [ ] **7.2** Apply, verify trigger installed, commit: `feat(junior): daily streak increments on mission completion`.

---

## Task 8: Missions tab + E2E smoke test

**Files:**
- Modify: `src/components/junior/JuniorLayout.tsx` — add Missions NavLink (in addition to Home / Chores / Jars).

- [ ] **8.1** Add the Missions NavLink (fourth tab) with a book/lightbulb SVG icon.

- [ ] **8.2** Manual E2E (open localhost:5173):
  1. Parent signs in → `/dashboard/junior` → click "Configure mission rewards" → set some to R5, others R0 → Save.
  2. Sign out, kid signs in → `/junior/missions` → 12 missions show.
  3. Tap one → step through hook → concept → quiz (pick an option) → tie-in → Finish.
  4. After finish, check DB:
     - `select status, quiz_score from kid_mission_progress where member_id = '<kid>';` → row with status='completed'.
     - `select source_type, amount_cents, notes from kid_ledger where source_type='lesson' order by earned_at desc limit 1;` → R5 (or whatever) row with status='owed'.
     - `select current_streak from kid_streaks where member_id = '<kid>';` → 1.
  5. Kid → `/junior/home` → owed shows updated amount, streak shows 1 day.
  6. Kid → `/junior/jars` → adjust to 60/20/20 → Save → refresh → sees 60/20/20.
  7. Parent signs in → `/dashboard/junior` → card shows updated owed amount.
  8. Mark as paid → split shows 60/20/20 (from kid's updated jar_split).
  9. Clean up test data.

- [ ] **8.3** Push + open PR + merge.

---

## Phase 3 — done criteria

- [ ] 12 missions seeded and readable by authenticated users (kid + parent).
- [ ] `useKidMissions` returns list + progress map.
- [ ] `JuniorMissionsPage` lists missions grouped by unit.
- [ ] `JuniorMissionPlayer` runs the 5-step flow and writes `kid_mission_progress`.
- [ ] DB trigger inserts a `kid_ledger` row on mission completion (reward from `kid_mission_rewards`).
- [ ] Parent UI can set reward-per-mission.
- [ ] Kid UI can adjust `jar_split` (must sum to 100).
- [ ] Streak increments on daily mission completion.
- [ ] Junior bottom nav has 4 tabs: Home, Chores, Jars, Missions.
- [ ] `npm run typecheck` clean.
- [ ] E2E smoke test passes.

## Deferred to Phase 4

- Notifications (approval nudge, Sunday settle-up reminder, optional daily digest)
- Freemium gates (1 child / 3 chores / 5 missions)
- Multi-kid lock screen
- Mission tree visualisation (Phase 3 ships flat lists)
- Custom parent-authored missions
- Charity integration for Give jar
