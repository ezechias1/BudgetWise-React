-- (Recorded here for reproducibility; applied to production on 2026-08-20.)

-- is_stokvel_member() tested stokvel_id and user_id and never `approved`, so the
-- owner's Approve/Reject buttons gated nothing. A joiner is inserted with
-- approved=false, which already satisfied every member-gated policy: the group
-- row, every contribution, every payout. Anyone forwarded an invite code could
-- read the whole ledger and the owner's bank account number before the owner
-- had decided anything, and money they contributed was stranded in the pot
-- under "Unknown" if they were then rejected.
create or replace function public.is_stokvel_member(sid uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1 from stokvel_members
    where stokvel_id = sid and user_id = auth.uid() and approved is true
  )
$function$;

-- Once the helper is tightened a pending joiner cannot read stokvel_groups at
-- all, so the "waiting for approval" screen has nothing to name. Their own
-- stokvel_members row stays readable, so this returns just enough to render it.
create or replace function public.get_pending_stokvel_memberships()
returns table(stokvel_id uuid, group_name text, monthly_amount numeric, joined_at timestamptz)
language sql stable security definer set search_path to 'public'
as $function$
  select g.id, g.name, g.monthly_amount, m.joined_at
  from stokvel_members m
  join stokvel_groups g on g.id = m.stokvel_id
  where m.user_id = auth.uid() and m.approved is not true
$function$;

revoke all on function public.get_pending_stokvel_memberships() from public, anon;
grant execute on function public.get_pending_stokvel_memberships() to authenticated;

-- handleAdvancePayout had no prior read, no busy state and no constraint, so a
-- double-tap wrote two identical payout rows — and for a single-member group
-- (0+1) % 1 = 0, so the index never moved and the button re-armed immediately.
-- This already happened in production: two identical R5,000 rows four seconds
-- apart. A browser-side guard is not a guarantee; two tabs defeat it.
delete from public.stokvel_payouts p
where exists (
  select 1 from public.stokvel_payouts q
  where q.stokvel_id = p.stokvel_id and q.month = p.month and q.created_at < p.created_at
);

create unique index if not exists stokvel_payouts_one_per_period
  on public.stokvel_payouts (stokvel_id, month);
