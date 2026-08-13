-- ============================================================
-- family_links write guard.
--
-- CONFIRMED EXPLOITABLE before this migration: any authenticated user
-- could insert a family_links row naming any group_id, their own
-- user_id, and approved = true — becoming a fully approved member of a
-- household they have no relationship to, with no owner action. From
-- there get_family_members() returned the real names of everyone in
-- that family.
--
-- Root cause: "joining creates a pending request" was only ever a UI
-- convention. The INSERT policy's with_check was (user_id = auth.uid())
-- and constrained nothing else, so `approved` and `group_id` were free
-- columns. The UPDATE policy had no with_check at all, so Postgres
-- derived it from USING — and the (user_id = auth.uid()) branch is
-- trivially satisfied by not touching user_id, leaving approved and
-- group_id rewritable.
--
-- WHY A TRIGGER AND NOT JUST A POLICY: RLS with_check only sees the NEW
-- row. It cannot express "group_id is unchanged" or "approved changed",
-- because OLD is not in scope. Column immutability is a trigger's job.
-- The policy below handles INSERT (where there is no OLD); the trigger
-- handles UPDATE.
-- ============================================================

-- ------------------------------------------------------------
-- INSERT: you may add yourself as a PENDING member, or add anyone if
-- you own the group. RESTRICTIVE so it ANDs with the existing
-- permissive policies — a permissive policy here would widen access and
-- close nothing (same reasoning as the expenses write guards).
-- ------------------------------------------------------------
drop policy if exists "family_links_insert_guard" on family_links;
create policy "family_links_insert_guard"
  on family_links as restrictive for insert to authenticated
  with check (
    is_group_owner(group_id)
    or (user_id = auth.uid() and approved is not true)
  );

-- Covers the three real insert paths:
--   owner auto-link on group create  → is_group_owner  → allowed
--   owner self-heal (orphaned owner) → is_group_owner  → allowed
--   join by invite code              → self + pending  → allowed
--   attacker self-approving          → neither branch  → REJECTED

-- ------------------------------------------------------------
-- UPDATE: group_id and user_id are identity and never editable —
-- changing household means delete and re-join. Only the group owner may
-- grant or revoke approval. Everything else on the row (display_name,
-- color, sharing_enabled, share_all, share_categories) stays freely
-- editable by the row's owner, which is what the existing permissive
-- policy already governs.
-- ------------------------------------------------------------
create or replace function family_links_guard_update()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if new.group_id is distinct from old.group_id then
    raise exception 'family_links.group_id cannot be changed (delete and re-join instead)'
      using errcode = '42501';
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception 'family_links.user_id cannot be changed'
      using errcode = '42501';
  end if;

  -- Checked against OLD.group_id: an attacker must not be able to gain
  -- approval rights by pointing the row at a group they happen to own.
  if (new.approved is distinct from old.approved)
     and not is_group_owner(old.group_id) then
    raise exception 'only the group owner can approve or remove a member'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists family_links_guard_update_trg on family_links;
create trigger family_links_guard_update_trg
  before update on family_links
  for each row execute function family_links_guard_update();

revoke all on function family_links_guard_update() from public, anon;

-- ------------------------------------------------------------
-- Clean-up of pre-existing damage.
--
-- Anyone who exploited this before the guard landed still holds an
-- approved row. Revoke approval for any member of a group whose row was
-- not created by the owner and is not the owner's own — they revert to
-- a pending request the owner can accept or reject, which is what the
-- product always intended.
--
-- ⚠️ REVIEW BEFORE RUNNING: this touches live membership. Run the
-- SELECT first and eyeball the rows — a legitimate member wrongly
-- demoted is recoverable in one click, but it is still churn for real
-- users, and on a small dataset it is worth reading the list.
--
--   select fl.id, fl.group_id, fl.user_id, fl.display_name, fl.approved
--   from family_links fl
--   join family_groups fg on fg.id = fl.group_id
--   where fl.approved is true and fl.user_id <> fg.owner_id;
--
-- update family_links fl
--    set approved = false
--   from family_groups fg
--  where fg.id = fl.group_id
--    and fl.approved is true
--    and fl.user_id <> fg.owner_id;
