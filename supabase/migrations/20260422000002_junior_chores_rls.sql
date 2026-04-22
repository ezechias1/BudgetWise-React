-- BudgetWise Junior — family_chores RLS for child accounts
-- Surfaced by P2-T5: kids couldn't SELECT or UPDATE their own chores because
-- the only existing policy was parent-scoped (auth.uid() = user_id).
--
-- Adds two additive policies:
--   1. "child reads own chores" — kid can SELECT chores where assignee ties
--      back to their family_members row via auth_user_id.
--   2. "child marks own chore pending" — kid can UPDATE, restricted by row
--      (still assigned to them) AND the WITH CHECK rejects completed=true,
--      so a kid cannot self-complete a chore (parent approval stays the gate).

create policy "child reads own chores"
  on family_chores for select to authenticated
  using (
    assignee in (
      select id from family_members where auth_user_id = auth.uid()
    )
  );

create policy "child marks own chore pending"
  on family_chores for update to authenticated
  using (
    assignee in (
      select id from family_members where auth_user_id = auth.uid()
    )
  )
  with check (
    assignee in (
      select id from family_members where auth_user_id = auth.uid()
    )
    and completed = false
  );
