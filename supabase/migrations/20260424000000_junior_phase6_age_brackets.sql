-- Junior Phase 6 — age brackets on missions
--
-- Each mission declares an age range. useKidMissions filters by the kid's
-- derived-from-DOB age. Existing seed mission is backfilled to 7-12 (broad)
-- and will be replaced in T5 by 5 bracket-specific missions × 4 brackets.

alter table kid_missions
  add column if not exists age_min smallint,
  add column if not exists age_max smallint;

-- Backfill existing mission(s) so the NOT NULL constraint below succeeds.
update kid_missions
set age_min = coalesce(age_min, 7),
    age_max = coalesce(age_max, 12);

alter table kid_missions
  alter column age_min set not null,
  alter column age_max set not null;

-- Sanity check: ages within Junior's scope, min <= max.
alter table kid_missions
  drop constraint if exists kid_missions_age_range_sane;
alter table kid_missions
  add constraint kid_missions_age_range_sane
  check (
    age_min between 7 and 17
    and age_max between 7 and 17
    and age_min <= age_max
  );

-- Query index: useKidMissions filters `where age_min <= :age and age_max >= :age`.
create index if not exists kid_missions_age_range_idx
  on kid_missions (age_min, age_max);
