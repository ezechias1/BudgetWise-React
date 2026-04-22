-- BudgetWise Junior — family_goals RLS for child accounts
-- Surfaced during P2-T6 implementation: family_goals has no `assignee`
-- column; it's scoped by parent `user_id` (a family-wide goal, not per-kid).
-- Additive policy: kid can SELECT goals created by their parent, via a
-- subquery that maps auth.uid() → family_members.user_id.

create policy "child reads parent family_goals"
  on family_goals for select to authenticated
  using (
    user_id in (
      select user_id from family_members where auth_user_id = auth.uid()
    )
  );
