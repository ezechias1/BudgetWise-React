-- kid_mission_reward_on_complete() only fires on the transition INTO 'completed'.
-- A parent who sets a mission's reward AFTER their child has already finished it
-- therefore never pays: the progress row is already 'completed', so replaying the
-- mission takes the ON CONFLICT UPDATE branch and the guard blocks. There was no
-- screen anywhere in the app that could pay the missed amount.
--
-- This is the other half of the same rule: when a reward is created or changed,
-- pay it for any child who already finished that mission and was never paid.
-- Together the two triggers mean the order of "child finishes" and "parent sets
-- the reward" no longer decides whether the child gets the money.
create or replace function public.kid_backfill_mission_reward()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.reward_amount_cents, 0) <= 0 then
    return new;
  end if;

  -- The NOT EXISTS is what makes this safe to run repeatedly: a mission already
  -- paid for a given child is never paid twice, whatever the parent does to the
  -- reward afterwards. Deliberately keyed on (member, 'lesson', mission) to match
  -- exactly what kid_mission_reward_on_complete() writes.
  insert into public.kid_ledger (user_id, member_id, amount_cents, source_type, source_id, status, notes)
  select new.user_id,
         p.member_id,
         new.reward_amount_cents,
         'lesson',
         new.mission_id,
         'owed',
         'Mission: ' || coalesce(ms.title, 'unknown')
  from public.kid_mission_progress p
  join public.family_members m on m.id = p.member_id and m.user_id = new.user_id
  left join public.kid_missions ms on ms.id = p.mission_id
  where p.mission_id = new.mission_id
    and p.status = 'completed'
    and not exists (
      select 1 from public.kid_ledger l
      where l.member_id = p.member_id
        and l.source_type = 'lesson'
        and l.source_id = p.mission_id
    );

  return new;
end;
$$;

drop trigger if exists kid_mission_rewards_backfill on public.kid_mission_rewards;
create trigger kid_mission_rewards_backfill
after insert or update of reward_amount_cents on public.kid_mission_rewards
for each row execute function public.kid_backfill_mission_reward();

-- Pay what is already owed. Same NOT EXISTS guard, so this cannot double-pay.
insert into public.kid_ledger (user_id, member_id, amount_cents, source_type, source_id, status, notes)
select m.user_id, p.member_id, r.reward_amount_cents, 'lesson', p.mission_id, 'owed',
       'Mission: ' || coalesce(ms.title, 'unknown')
from public.kid_mission_progress p
join public.family_members m on m.id = p.member_id
join public.kid_mission_rewards r on r.mission_id = p.mission_id and r.user_id = m.user_id
left join public.kid_missions ms on ms.id = p.mission_id
where p.status = 'completed'
  and coalesce(r.reward_amount_cents, 0) > 0
  and not exists (
    select 1 from public.kid_ledger l
    where l.member_id = p.member_id and l.source_type = 'lesson' and l.source_id = p.mission_id
  );
