-- Rename the assistant from Orbit to Compass.
--
-- `0001_init.sql` created two preference columns named after the old assistant.
-- The application now reads and writes `compass_*`, so the columns move with it
-- rather than leaving the code querying names that no longer describe anything.
--
-- Written to be safe to run more than once, and safe to run against a database
-- that was created after the rename (where the new names already exist).

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_preferences' and column_name = 'orbit_tone'
  ) then
    alter table public.user_preferences rename column orbit_tone to compass_tone;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_preferences'
      and column_name = 'orbit_auto_run_read_tools'
  ) then
    alter table public.user_preferences
      rename column orbit_auto_run_read_tools to compass_auto_run_read_tools;
  end if;
end
$$;
