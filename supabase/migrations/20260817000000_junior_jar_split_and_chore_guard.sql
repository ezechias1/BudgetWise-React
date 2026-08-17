-- ============================================================
-- Junior: let a kid set their own jar split, and stop a kid rewriting
-- what a chore is worth.
--
-- Two separate problems, deliberately fixed two different ways.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Jar split — the kid has no write access at all today.
--
-- `family_members` has one write policy ("Users manage own family
-- members", auth.uid() = user_id), which is the PARENT's id. A kid's
-- auth user is distinct, so nothing accepts their UPDATE — it returns
-- 200 with zero rows and no error, and the app showed "Saved!" while
-- the split never changed.
--
-- WHY AN RPC AND NOT A POLICY: family_members also holds `earned`,
-- `allowance`, `spent` and `role`. A policy's WITH CHECK can pin
-- specific values but cannot say "every other column must stay as it
-- was", so any policy broad enough to let a kid set jar_split would
-- also let them award themselves money or promote themselves to
-- parent. An RPC that accepts only the three jar numbers is the
-- narrowest possible grant.
--
-- Identity is resolved server-side from the JWT. The client never
-- passes a member_id, so it cannot aim this at a sibling.
-- ------------------------------------------------------------
create or replace function set_my_jar_split(p_save int, p_spend int, p_give int)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_member uuid;
begin
  select id into v_member
    from family_members
   where auth_user_id = auth.uid()
   limit 1;

  if v_member is null then
    raise exception 'no kid account for this session' using errcode = '42501';
  end if;

  if p_save is null or p_spend is null or p_give is null then
    raise exception 'jar split needs all three values' using errcode = '22023';
  end if;

  if least(p_save, p_spend, p_give) < 0
     or greatest(p_save, p_spend, p_give) > 100
     or (p_save + p_spend + p_give) <> 100 then
    raise exception 'jar split must be three values between 0 and 100 that add up to 100'
      using errcode = '22023';
  end if;

  update family_members
     set jar_split = jsonb_build_object('save', p_save, 'spend', p_spend, 'give', p_give)
   where id = v_member;
end;
$$;

revoke all on function set_my_jar_split(int, int, int) from public, anon;
grant execute on function set_my_jar_split(int, int, int) to authenticated;


-- ------------------------------------------------------------
-- 2. Chore reward inflation — CONFIRMED EXPLOITABLE.
--
-- The "child marks own chore pending" policy constrains only
-- `completed = false` in its WITH CHECK. Nothing pins `reward`, so a
-- kid marking a chore as done can raise its value in the same request:
--
--   UPDATE family_chores SET pending_approval = true, reward = 5000
--   → accepted; a R10 chore became a R5000 chore, kid-initiated.
--
-- WHY A TRIGGER AND NOT A POLICY: WITH CHECK sees only the NEW row, so
-- it cannot express "reward must equal what it was". Marking a chore
-- done is also not a single-purpose action the way setting a jar split
-- is — the parent legitimately edits name, reward and frequency — so
-- wrapping it in a narrow RPC would be the wrong shape. Same reasoning
-- as the family_links write guard.
--
-- The rule: if you are not the parent who owns the chore, you may move
-- it through its workflow, and nothing else.
-- ------------------------------------------------------------
create or replace function family_chores_guard_update()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  -- Ownership is never transferable by anyone.
  if new.user_id is distinct from old.user_id then
    raise exception 'family_chores.user_id cannot be changed' using errcode = '42501';
  end if;

  -- The owning parent may edit the chore itself; a kid may not.
  if auth.uid() is distinct from old.user_id then
    if new.reward    is distinct from old.reward
    or new.name      is distinct from old.name
    or new.frequency is distinct from old.frequency
    or new.assignee  is distinct from old.assignee then
      raise exception 'only a parent can change a chore''s reward, name, frequency or who it is for'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists family_chores_guard_update_trg on family_chores;
create trigger family_chores_guard_update_trg
  before update on family_chores
  for each row execute function family_chores_guard_update();

revoke all on function family_chores_guard_update() from public, anon;


-- ------------------------------------------------------------
-- Worth checking after applying: whether any chore already carries an
-- inflated reward from before the guard existed.
--
--   select id, name, reward, user_id
--     from family_chores
--    where reward > 500
--    order by reward desc;
--
-- Nothing is corrected automatically — a legitimately expensive chore
-- is possible, so this needs eyes rather than a blanket update.
-- ------------------------------------------------------------
