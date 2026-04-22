-- Tighten the parent-side kid_ledger RLS so a parent cannot write a row
-- attributed to a member_id they don't own. Addresses Phase 1 code-review
-- Issue 1 (see code review of commit 85ea6e0).

drop policy if exists "parent manages own ledger" on kid_ledger;

create policy "parent manages own ledger"
  on kid_ledger for all to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and member_id in (
      select id from family_members where user_id = auth.uid()
    )
  );
