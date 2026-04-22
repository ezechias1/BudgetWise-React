-- BudgetWise Junior — tighten kid_mission_progress RLS before Phase 3
--
-- Phase 1 shipped "child manages own progress" as a blanket FOR ALL policy,
-- letting a kid INSERT/UPDATE reward_amount_cents and quiz_score with any
-- value. Before Phase 3 wires missions → ledger, close that hole.
--
-- New shape:
--   - SELECT: kid can read own progress (unchanged behaviour).
--   - INSERT/UPDATE: kid can write status / completed_at / quiz_score on
--     own rows ONLY — reward_amount_cents must remain NULL on kid writes.
--     Parent keeps full FOR ALL via the pre-existing "parent manages own
--     children progress" policy.

drop policy if exists "child manages own progress" on kid_mission_progress;

create policy "child reads own mission progress"
  on kid_mission_progress for select to authenticated
  using (
    member_id in (
      select id from family_members where auth_user_id = auth.uid()
    )
  );

create policy "child inserts own mission progress"
  on kid_mission_progress for insert to authenticated
  with check (
    member_id in (
      select id from family_members where auth_user_id = auth.uid()
    )
    and reward_amount_cents is null
  );

create policy "child updates own mission progress non-reward"
  on kid_mission_progress for update to authenticated
  using (
    member_id in (
      select id from family_members where auth_user_id = auth.uid()
    )
  )
  with check (
    member_id in (
      select id from family_members where auth_user_id = auth.uid()
    )
    and reward_amount_cents is null
  );
