-- Ten user-owned tables referenced auth.users with ON DELETE NO ACTION, so
-- deleting an auth user raised 23503 and failed. That is the shared root cause
-- of two separate defects: "Purge Entire Account" left the account loginable,
-- and removing a Junior kid destroyed their login while leaving the row behind.
-- Both were being worked around in application code, table by table, in a list
-- that had already drifted out of date once.
--
-- Every one of these is data owned by exactly one account and meaningless
-- without it, so the database should be the thing that guarantees it goes.
-- Every OTHER table already cascades — these ten were the outliers.
--
-- audit_logs cascades too. Its user_id is NOT NULL so SET NULL is not available,
-- and for a genuine account-deletion request retaining the trail keyed to the
-- deleted account would be the wrong answer anyway.
alter table public.user_settings       drop constraint user_settings_user_id_fkey,
  add constraint user_settings_user_id_fkey       foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.expenses            drop constraint expenses_user_id_fkey,
  add constraint expenses_user_id_fkey            foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.savings_goals       drop constraint savings_goals_user_id_fkey,
  add constraint savings_goals_user_id_fkey       foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.custom_categories   drop constraint custom_categories_user_id_fkey,
  add constraint custom_categories_user_id_fkey   foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.linked_accounts     drop constraint linked_accounts_user_id_fkey,
  add constraint linked_accounts_user_id_fkey     foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.clients             drop constraint clients_user_id_fkey,
  add constraint clients_user_id_fkey             foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.invoices            drop constraint invoices_user_id_fkey,
  add constraint invoices_user_id_fkey            foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.trips               drop constraint trips_user_id_fkey,
  add constraint trips_user_id_fkey               foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.kid_money_requests  drop constraint kid_money_requests_user_id_fkey,
  add constraint kid_money_requests_user_id_fkey  foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.audit_logs          drop constraint audit_logs_user_id_fkey,
  add constraint audit_logs_user_id_fkey          foreign key (user_id) references auth.users(id) on delete cascade;
