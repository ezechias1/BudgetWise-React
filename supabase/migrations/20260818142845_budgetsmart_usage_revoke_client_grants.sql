-- Belt and braces on top of the empty-policy RLS: revoke the table grants the
-- client roles inherit by default, so a quota row cannot be read or reset by
-- anyone holding a browser token even if a policy is ever added by mistake.
revoke all on table public.budgetsmart_usage from anon, authenticated;
revoke all on function public.budgetsmart_bump(uuid, integer) from anon, authenticated;
