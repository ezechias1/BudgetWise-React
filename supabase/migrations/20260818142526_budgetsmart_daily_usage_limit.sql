-- Per-user daily cap for the BudgetSmart assistant, enforced server-side.
-- The client cannot be trusted with a spend limit, so the counter lives here
-- and the edge function is the only thing allowed to move it.
create table if not exists public.budgetsmart_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  count integer not null default 0,
  primary key (user_id, day)
);

-- RLS on with NO policies: nothing holding an anon or authenticated JWT can
-- read or write this table at all. Only the service role (which bypasses RLS)
-- inside the edge function touches it.
alter table public.budgetsmart_usage enable row level security;

create or replace function public.budgetsmart_bump(p_user uuid, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  new_count integer;
begin
  insert into public.budgetsmart_usage as u (user_id, day, count)
  values (p_user, current_date, 1)
  on conflict (user_id, day)
    do update set count = u.count + 1
  returning u.count into new_count;

  return new_count <= p_limit;
end;
$function$;
