-- Stokvel contributions also write a normal `expenses` row so they show in
-- totals/pie charts (StokvelPage.tsx, category='Stokvel') — but auto_tag_trip
-- matches purely by date range with no awareness of category, so a
-- contribution falling inside a trip's date window was getting swept into
-- that trip's expense list. A recurring savings-group payment isn't a trip
-- expense regardless of what dates a trip happens to span.
--
-- Re-defines auto_tag_trip() (source: live function body, confirmed via
-- information_schema earlier this session) adding one condition: never tag
-- a Stokvel-category expense to a trip.

create or replace function auto_tag_trip()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.trip_id is null
     and new.account_mode in ('personal', 'family')
     and new.category is distinct from 'Stokvel' then
    select id into new.trip_id
    from trips
    where trips.user_id = new.user_id
      and new.date between trips.start_date and trips.end_date
      and trips.account_mode = new.account_mode
    order by trips.created_at desc
    limit 1;
  end if;
  return new;
end;
$$;

-- One-time backfill: untag any Stokvel expense that was already wrongly
-- swept into a trip before this fix.
update expenses
set trip_id = null
where category = 'Stokvel'
  and trip_id is not null;
