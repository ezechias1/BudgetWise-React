-- stokvel_contribs_insert had no membership test.
--
--   with check ((user_id = auth.uid()) OR is_stokvel_owner(stokvel_id))
--
-- The first disjunct is satisfied by ANY authenticated user for ANY stokvel_id,
-- because it only checks that you are writing the row under your own id — never
-- that you belong to the group you are writing it into. Compare the SELECT
-- policy sitting beside it, which correctly requires owner OR member.
--
-- stokvel_id is not a secret: find_stokvel_group_by_code() is SECURITY DEFINER
-- with no membership check and returns the group id to anyone holding the code,
-- and codes are copied out of the UI and shared over WhatsApp to recruit people.
-- A circulating code is the normal state of a stokvel, not an edge case. So any
-- logged-in stranger could write payment rows into any group.
--
-- Today that writes rows the stranger cannot read back. It stops being cosmetic
-- the moment a contribution insert can fan a push notification out to every
-- member's lock screen, which is the feature being built next.
--
-- Both legitimate writers still pass:
--   a member recording their own payment  -> user_id = auth.uid() AND approved member
--   the owner confirming someone's payment -> is_stokvel_owner(stokvel_id)
-- is_stokvel_member() already requires `approved is true`, so a pending joiner
-- loses a write they should never have had.
alter policy stokvel_contribs_insert
  on public.stokvel_contributions
  with check (
    (user_id = auth.uid() and public.is_stokvel_member(stokvel_id))
    or public.is_stokvel_owner(stokvel_id)
  );
