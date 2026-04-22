-- Junior Phase 4 · P4-T2: approval-nudge notifications
-- The existing `parent manages own notifications` policy (auth.uid() = user_id)
-- blocks a kid from inserting a notification addressed to their parent —
-- the kid's auth.uid() will never match the parent's user_id. Add a narrow
-- INSERT policy that lets an authenticated kid enqueue a notification row
-- whose user_id belongs to the parent they're linked to via family_members.
create policy "kid inserts parent notification"
  on kid_notifications for insert to authenticated
  with check (
    user_id in (
      select user_id from family_members where auth_user_id = auth.uid()
    )
  );
