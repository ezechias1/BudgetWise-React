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
