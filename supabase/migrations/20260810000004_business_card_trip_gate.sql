-- A business card is the company's money, not the user's — it has no
-- business appearing in this personal budgeting app at all except during an
-- actual trip. This adds the enforcement: any expense synced from a
-- linked_accounts row flagged is_business_card that doesn't land inside one
-- of the user's trip date ranges is discarded outright (never inserted),
-- rather than merely hidden from totals like a pending/business trip
-- expense already is.

alter table expenses
  add column if not exists linked_account_id uuid references linked_accounts (id) on delete set null;

create index if not exists expenses_linked_account_id_idx on expenses (linked_account_id);

-- Re-defines assign_expense_trip() from 20260810000000_trips.sql, adding the
-- business-card gate on top of the existing date-range auto-tag logic.
create or replace function assign_expense_trip()
returns trigger as $$
declare
  matched_trip_id uuid;
  from_business_card boolean;
begin
  if new.account_mode not in ('personal', 'family') then
    new.trip_id := null;
    return new;
  end if;

  if tg_op = 'UPDATE' and new.trip_id is distinct from old.trip_id then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.date = old.date
     and new.account_mode = old.account_mode
     and new.user_id = old.user_id then
    return new;
  end if;

  select id into matched_trip_id
  from trips
  where trips.user_id = new.user_id
    and trips.account_mode = new.account_mode
    and new.date between trips.start_date and trips.end_date
  order by trips.created_at desc
  limit 1;

  if new.linked_account_id is not null then
    select is_business_card into from_business_card
    from linked_accounts
    where id = new.linked_account_id;

    -- Business-card spend outside any trip window isn't the user's money
    -- and isn't trip-related either — nothing legitimate for it to do in
    -- this app. Returning null from a BEFORE INSERT trigger silently drops
    -- the row (no error, never written, never rendered anywhere).
    if from_business_card and matched_trip_id is null then
      return null;
    end if;
  end if;

  new.trip_id := matched_trip_id;
  return new;
end;
$$ language plpgsql security definer;
