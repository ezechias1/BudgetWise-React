-- ============================================================
-- Combined household income for Family mode.
--
-- Each partner keeps their own login and sets their own
-- user_settings.fam_income. The Family home page shows the combined
-- total with a per-person breakdown.
--
-- Deliberately NOT implemented as an RLS policy on user_settings.
-- Postgres RLS is row-level, not column-level, so any policy letting a
-- partner read another user's user_settings row would also expose
-- is_pro, has_paid, paypal_subscription_id, subscription_plan,
-- budget_limits and everything else on that row. This RPC returns only
-- the three fields the feature needs and leaves user_settings locked to
-- its existing "user_id = auth.uid()" policy, untouched.
--
-- Follows the SECURITY DEFINER helper pattern already used for
-- is_stokvel_owner / is_stokvel_member in
-- 20260810000006_live_schema_trips_business_card_stokvel_rls.sql.
--
-- ⚠️ Confirm before applying: that family_links.display_name is `text`
-- and family_links.user_id is `uuid`. These tables have no create-table
-- history in this repo, so the signature below is written from the
-- app's TypeScript types, not from verified DDL.
-- ============================================================

-- Is the caller an approved member of this family group?
-- SECURITY DEFINER so it can see family_links rows the caller's own RLS
-- policy would hide, without re-triggering policy evaluation (which is
-- what would otherwise recurse).
create or replace function is_approved_family_member(gid uuid)
returns boolean
language sql stable security definer set search_path = 'public'
as $$
  select exists (
    select 1 from family_links
    where group_id = gid
      and user_id = auth.uid()
      and approved is true
  )
$$;

-- Per-member family income for one group.
--
-- The membership guard sits in the WHERE clause rather than raising:
-- a non-member gets zero rows back instead of an error, so this can't
-- be used to probe whether a given group id exists.
create or replace function get_family_income(p_group_id uuid)
returns table (user_id uuid, display_name text, fam_income numeric)
language sql stable security definer set search_path = 'public'
as $$
  select
    fl.user_id,
    fl.display_name,
    coalesce(us.fam_income, 0)::numeric
  from family_links fl
  left join user_settings us on us.user_id = fl.user_id
  where fl.group_id = p_group_id
    and fl.approved is true
    and is_approved_family_member(p_group_id)
$$;

-- These return another user's data, so keep them off anon explicitly
-- rather than relying on default grants.
revoke all on function is_approved_family_member(uuid) from public, anon;
revoke all on function get_family_income(uuid) from public, anon;
grant execute on function is_approved_family_member(uuid) to authenticated;
grant execute on function get_family_income(uuid) to authenticated;
