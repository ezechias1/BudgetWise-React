-- Deleting a family goal that any kid money request pointed at failed with
--   violates foreign key constraint "kid_money_requests_goal_id_fkey"
-- because kid_money_requests.goal_id was declared as a plain
-- `references family_goals(id)` in 20260811000000, which defaults to
-- ON DELETE NO ACTION.
--
-- A money request is ledger history — "dave asked for R100 on this date, you
-- approved R20" stays true and worth keeping even after the goal it was aimed
-- at is gone. So detach rather than cascade: goal_id is already nullable and
-- documented as optional, so ON DELETE SET NULL preserves the request rows and
-- unblocks the delete.
--
-- Additive/idempotent, matching this repo's migration conventions.

alter table kid_money_requests
  drop constraint if exists kid_money_requests_goal_id_fkey;

alter table kid_money_requests
  add constraint kid_money_requests_goal_id_fkey
  foreign key (goal_id) references family_goals(id) on delete set null;
