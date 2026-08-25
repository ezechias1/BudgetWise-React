-- Income ledger, part 2: the read path and the seed.

-- 5. READ PATH — income per month, per member.
--
-- SECURITY INVOKER, and that is the point. get_family_income had to be SECURITY
-- DEFINER because user_settings is locked to user_id = auth.uid() and there is
-- no way to expose one column of another user's row without also exposing
-- is_pro / has_paid / paypal_subscription_id. income_entries has a real family
-- SELECT policy, so this runs under the CALLER'S OWN RLS and still returns the
-- household:
--   personal/business -> own rows only      (owner policy)
--   family            -> own + group-mates' (family policy)
--   another household -> zero rows          (no policy matches)
-- No privilege escalation anywhere in the income read path.
--
-- tithable_total is returned alongside total because ExpenseModal's Tithe
-- autofill and AccountPage both need 10% of the TITHABLE subset, not of
-- everything. Without it those two render `undefined * 0.1` = NaN — a literal
-- "R NaN" on the Account page — or silently fall back to the full total and
-- diverge the first time anyone unticks the box.
--
-- CLIENT NOTE: call this with destructured `error`. A bare
-- `const { data } = await supabase.rpc(...)` returns null on failure, the client
-- reads income as 0, and the balance "jumps" to -totalSpent — the exact failure
-- mode this whole feature exists to avoid.
create or replace function public.income_for_months(
  p_mode text,
  p_from date,
  p_to   date
)
returns table (month date, member_id uuid, total numeric, tithable_total numeric)
language sql stable security invoker set search_path = 'public'
as $$
  select
    m.month::date,
    coalesce(e.received_by, e.user_id) as member_id,
    sum(e.amount)::numeric as total,
    coalesce(sum(e.amount) filter (where e.is_tithable), 0)::numeric as tithable_total
  from generate_series(
         date_trunc('month', p_from)::date,
         date_trunc('month', p_to)::date,
         interval '1 month'
       ) as m(month)
  join income_entries e
    on e.account_mode = p_mode
   and (
        -- one-off: counts only in its own month
        (not e.recurs and date_trunc('month', e.date)::date = m.month::date)
        -- recurring: started on or before this month, not yet ended
     or (e.recurs
         and e.date < (m.month + interval '1 month')
         and (e.ends_on is null or e.ends_on >= m.month::date))
       )
  group by m.month, coalesce(e.received_by, e.user_id)
$$;

revoke all on function public.income_for_months(text, date, date) from public, anon;
grant execute on function public.income_for_months(text, date, date) to authenticated;

-- 6. SEED — one recurring entry per non-zero scalar per user.
--
-- coalesce() is REQUIRED and the three columns need it for different reasons:
-- income is NOT NULL default 0 while biz_income and fam_income are NULLABLE.
-- Without it the lateral emits nulls, `null > 0` is null, and rows vanish.
--
-- `where m.amt > 0` means a user whose income is 0 gets NO ROW, not a zero row.
-- Today `row?.income ?? 0` yields 0 and an empty sum yields 0, so this is
-- byte-identical — and it keeps the ledger honest, because an empty ledger means
-- "you haven't told us your income", which is what advice.ts's income === 0
-- branch is for.
--
-- THE BACKDATE IS THE THING MOST LIKELY TO BE MISSED. useOverviewStats and
-- SavingsPage each independently compute six months of `saved: max(0, income -
-- monthTotal)` using TODAY'S income. Seed only from this month and all five
-- prior months read income 0, so every user's savings trend flatlines on ship
-- day — visually the same catastrophe as a jumping balance. Eleven months gives
-- the six-month window five months of margin so a rollout crossing a month
-- boundary cannot clip it.
--
-- This is not a claim the user earned that money last September. It is the
-- honest encoding of what the scalar already meant: one figure retroactively
-- applied to all history.
--
-- RE-RUN THIS after the client deploy. It is idempotent via
-- income_entries_migrated_uniq, and anyone who edits their income scalar in the
-- old client between this migration and the deploy would otherwise have a stale
-- seed and read the wrong figure afterwards.
insert into public.income_entries
  (user_id, account_mode, group_id, received_by, amount,
   category, description, date, recurs, ends_on, is_tithable, source)
select
  us.user_id,
  m.mode,
  case when m.mode = 'family' then (
    select fl.group_id
    from family_links fl
    where fl.user_id = us.user_id and fl.approved is true
    order by fl.group_id
    limit 1
  ) end,
  us.user_id,
  m.amt,
  'Salary',
  'Monthly income (imported from your settings)',
  (date_trunc('month', current_date) - interval '11 months')::date,
  true,
  null,
  true,
  'migrated'
from public.user_settings us
cross join lateral (values
  ('personal', coalesce(us.income, 0)),
  ('business', coalesce(us.biz_income, 0)),
  ('family',   coalesce(us.fam_income, 0))
) as m(mode, amt)
where m.amt > 0
on conflict (user_id, account_mode) where source = 'migrated' do nothing;

-- 7. DEPRECATE, DO NOT DROP. The old columns stay dormant so
-- handle_new_user_settings() and pre-migration backup restores keep working.
--
-- FOLLOW-UP DROP MIGRATION, in this order, in a LATER release:
--   a) rewrite handle_new_user_settings() to stop naming `income` — it is
--      wrapped in `exception when others then return new`, so if the column is
--      dropped first, every new signup silently gets NO settings row at all
--   b) ship the AccountPage restore strip-list for the three keys
--   c) drop function get_family_income(uuid)
--   d) alter table user_settings drop column income, biz_income, fam_income
-- Keep user_settings_income_backup_20260825 indefinitely.
comment on column public.user_settings.income is
  'DEPRECATED 2026-08-25 - superseded by income_entries. Kept dormant so handle_new_user_settings() and pre-migration backup restores keep working.';
comment on column public.user_settings.biz_income is
  'DEPRECATED 2026-08-25 - superseded by income_entries. Kept dormant.';
comment on column public.user_settings.fam_income is
  'DEPRECATED 2026-08-25 - superseded by income_entries. Still read by get_family_income(uuid), itself dead once the new client ships.';
