-- BudgetWise Junior — streak increment on mission/chore activity

create or replace function kid_streak_on_activity()
returns trigger as $$
declare
  today date := current_date;
  row kid_streaks%rowtype;
  new_current integer;
begin
  -- Only fire when mission newly completes
  if tg_table_name = 'kid_mission_progress' then
    if not (new.status = 'completed' and (old is null or old.status != 'completed')) then
      return new;
    end if;
  end if;

  select * into row from kid_streaks where member_id = new.member_id;
  if not found then
    insert into kid_streaks (member_id, current_streak, longest_streak, last_active_date)
    values (new.member_id, 1, 1, today);
    return new;
  end if;

  if row.last_active_date = today then
    return new;  -- already counted today
  elsif row.last_active_date = today - interval '1 day' then
    new_current := row.current_streak + 1;
  else
    new_current := 1;  -- streak broke
  end if;

  update kid_streaks set
    current_streak = new_current,
    longest_streak = greatest(row.longest_streak, new_current),
    last_active_date = today
  where member_id = new.member_id;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists kid_streak_mission_progress on kid_mission_progress;
create trigger kid_streak_mission_progress
  after insert or update on kid_mission_progress
  for each row execute function kid_streak_on_activity();
