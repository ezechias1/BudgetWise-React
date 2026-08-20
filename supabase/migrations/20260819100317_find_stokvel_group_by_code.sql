-- Joining a stokvel by code was impossible for everyone. stokvel_groups' SELECT
-- policy is `owner_id = auth.uid() OR is_stokvel_member(id)`, and somebody
-- holding an invite code is by definition neither — so the lookup returned no
-- rows and the UI said "Invalid code. Check with the stokvel admin." every time.
--
-- Same shape as the family-invite solution: a narrow SECURITY DEFINER lookup
-- returning only the three fields a joiner needs to confirm they have the right
-- group. Deliberately not `select *` — the caller is not a member yet.
create or replace function public.find_stokvel_group_by_code(p_code text)
returns table(id uuid, name text, monthly_amount numeric)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select sg.id, sg.name, sg.monthly_amount
  from stokvel_groups sg
  where upper(trim(sg.stokvel_code)) = upper(trim(p_code))
  limit 1
$function$;

revoke all on function public.find_stokvel_group_by_code(text) from public, anon;
grant execute on function public.find_stokvel_group_by_code(text) to authenticated;
