-- AaditOS initial schema.
--
-- Every private table is owned by a user, has Row Level Security enabled, and
-- carries a policy set that only ever matches `auth.uid()`. Imported rows use
-- (user_id, source, source_ref) unique constraints so re-running a sync updates
-- instead of duplicating.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- helpers --

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- --------------------------------------------------------------- profiles --

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  name         text not null default '',
  avatar_url   text,
  school       text not null default 'Wilcox High School',
  grade        text not null default 'Grade 9',
  city         text not null default 'Santa Clara, CA',
  timezone     text not null default 'America/Los_Angeles',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- courses --

create table if not exists public.courses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null,
  teacher      text,
  room         text,
  period       integer,
  color        text not null default 'var(--chart-1)',
  grade        text,
  source       text not null default 'manual',
  source_ref   text,
  external_url text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint courses_source_unique unique (user_id, source, source_ref)
);
create index if not exists courses_user_idx on public.courses (user_id);

-- ------------------------------------------------------------------ tasks --

create table if not exists public.tasks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  title         text not null check (char_length(title) between 1 and 300),
  description   text,
  category      text not null default 'personal' check (category in ('school', 'work', 'personal')),
  course_id     uuid references public.courses (id) on delete set null,
  project_id    text,
  due_at        timestamptz,
  due_all_day   boolean not null default false,
  start_at      timestamptz,
  priority      text not null default 'normal' check (priority in ('urgent', 'high', 'normal', 'low')),
  status        text not null default 'todo' check (status in ('todo', 'in_progress', 'done', 'archived')),
  estimate_min  integer not null default 30 check (estimate_min between 1 and 1440),
  actual_min    integer,
  source        text not null default 'manual',
  source_ref    text,
  external_url  text,
  notes         text,
  subtasks      jsonb not null default '[]'::jsonb,
  position      integer not null default 0,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint tasks_source_unique unique (user_id, source, source_ref)
);
create index if not exists tasks_user_status_idx on public.tasks (user_id, status) where deleted_at is null;
create index if not exists tasks_user_due_idx on public.tasks (user_id, due_at) where deleted_at is null;

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------ assignments --

create table if not exists public.assignments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  course_id     uuid references public.courses (id) on delete set null,
  title         text not null,
  description   text,
  due_at        timestamptz,
  due_all_day   boolean not null default false,
  state         text not null default 'assigned'
    check (state in ('assigned', 'due_soon', 'missing', 'submitted', 'graded')),
  estimate_min  integer not null default 30,
  points        integer,
  grade         text,
  source        text not null default 'manual',
  source_ref    text,
  external_url  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint assignments_source_unique unique (user_id, source, source_ref)
);
create index if not exists assignments_user_due_idx on public.assignments (user_id, due_at);

-- ----------------------------------------------------------------- events --

create table if not exists public.events (
  id            text primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  title         text not null,
  description   text,
  location      text,
  start_at      timestamptz not null,
  end_at        timestamptz,
  all_day       boolean not null default false,
  kind          text not null default 'personal',
  source        text not null default 'manual',
  calendar_id   text not null,
  source_ref    text,
  external_url  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists events_user_start_idx on public.events (user_id, start_at);
create index if not exists events_user_calendar_idx on public.events (user_id, calendar_id);

-- --------------------------------------------------------------- projects --

create table if not exists public.projects (
  id              text not null,
  user_id         uuid not null references auth.users (id) on delete cascade,
  name            text not null,
  kind            text not null default '',
  objective       text not null default '',
  progress        integer not null default 0 check (progress between 0 and 100),
  health          text not null default 'on_track' check (health in ('on_track', 'attention', 'at_risk')),
  blockers        jsonb not null default '[]'::jsonb,
  deadline_at     timestamptz,
  deadline_label  text,
  contact         text,
  github_repo     text,
  vercel_project  text,
  links           jsonb not null default '[]'::jsonb,
  metrics         jsonb not null default '[]'::jsonb,
  documents       jsonb not null default '[]'::jsonb,
  activity        jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.project_memberships (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  project_id  text not null,
  person      text not null,
  role        text not null default 'collaborator',
  created_at  timestamptz not null default now(),
  constraint project_memberships_unique unique (user_id, project_id, person)
);

create table if not exists public.project_activity (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  project_id  text not null,
  occurred_at timestamptz not null default now(),
  text        text not null,
  source      text not null default 'manual',
  url         text,
  dedupe_key  text not null,
  created_at  timestamptz not null default now(),
  constraint project_activity_unique unique (user_id, dedupe_key)
);
create index if not exists project_activity_idx on public.project_activity (user_id, project_id, occurred_at desc);

-- ---------------------------------------------------------- opportunities --

create table if not exists public.opportunities (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  org                   text not null,
  title                 text not null,
  type                  text not null default 'application'
    check (type in ('internship', 'hackathon', 'founder', 'sponsorship', 'application', 'event')),
  stage                 text not null default 'discovered'
    check (stage in ('discovered', 'interested', 'applied', 'follow_up', 'interview', 'accepted', 'closed')),
  contact               text,
  deadline_at           timestamptz,
  last_interaction_at   timestamptz,
  last_interaction_note text,
  next_action           text,
  notes                 text,
  related_email         text,
  related_url           text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists opportunities_user_stage_idx on public.opportunities (user_id, stage);

-- --------------------------------------------------------- focus_sessions --

create table if not exists public.focus_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  task_id      uuid references public.tasks (id) on delete set null,
  task_title   text not null,
  category     text not null default 'personal',
  planned_min  integer not null default 25,
  elapsed_sec  integer not null default 0,
  status       text not null default 'running'
    check (status in ('running', 'paused', 'completed', 'cancelled')),
  started_at   timestamptz not null default now(),
  resumed_at   timestamptz,
  ended_at     timestamptz,
  reflection   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists focus_sessions_user_started_idx on public.focus_sessions (user_id, started_at desc);

-- ---------------------------------------------------------- notifications --

create table if not exists public.notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  category      text not null default 'system'
    check (category in ('urgent', 'school', 'projects', 'opportunities', 'system')),
  title         text not null,
  detail        text,
  source        text not null default 'manual',
  href          text,
  external_url  text,
  read          boolean not null default false,
  dedupe_key    text not null,
  created_at    timestamptz not null default now(),
  constraint notifications_dedupe_unique unique (user_id, dedupe_key)
);
create index if not exists notifications_user_read_idx on public.notifications (user_id, read, created_at desc);

-- ----------------------------------------------------------- integrations --

create table if not exists public.integrations (
  id            text not null,
  user_id       uuid not null references auth.users (id) on delete cascade,
  status        text not null default 'disconnected'
    check (status in ('connected', 'disconnected', 'error', 'unavailable', 'demo')),
  last_sync_at  timestamptz,
  last_error    text,
  meta          jsonb not null default '{}'::jsonb,
  -- Provider refresh tokens are AES-GCM encrypted before they are written here.
  -- Never store a plaintext token in this column.
  encrypted_token text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.sync_runs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  provider     text not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ok           boolean not null default false,
  imported     integer not null default 0,
  updated      integer not null default 0,
  skipped      integer not null default 0,
  message      text
);
create index if not exists sync_runs_user_idx on public.sync_runs (user_id, started_at desc);

-- ------------------------------------------------------- user_preferences --

create table if not exists public.user_preferences (
  user_id                       uuid primary key references auth.users (id) on delete cascade,
  theme                         text not null default 'system' check (theme in ('light', 'dark', 'system')),
  focus_goal_hours              integer not null default 10,
  weekly_task_goal              integer not null default 18,
  workday_start                 text not null default '07:00',
  workday_end                   text not null default '21:30',
  muted_notification_categories jsonb not null default '[]'::jsonb,
  browser_notifications         boolean not null default false,
  orbit_tone                    text not null default 'concise',
  orbit_auto_run_read_tools     boolean not null default true,
  reduced_motion                boolean not null default false,
  updated_at                    timestamptz not null default now()
);

-- --------------------------------------------------------------- ai state --

create table if not exists public.ai_conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null default 'Conversation',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Usage accounting only. Prompt and response bodies are deliberately not stored.
create table if not exists public.ai_usage_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  model           text not null,
  input_tokens    integer not null default 0,
  output_tokens   integer not null default 0,
  tool_calls      integer not null default 0,
  ok              boolean not null default true,
  error_code      text,
  created_at      timestamptz not null default now()
);
create index if not exists ai_usage_user_idx on public.ai_usage_events (user_id, created_at desc);

create table if not exists public.ai_action_proposals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid references public.ai_conversations (id) on delete cascade,
  tool          text not null,
  payload       jsonb not null,
  status        text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz
);

-- --------------------------------------------------------- row level security

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'courses', 'tasks', 'assignments', 'events', 'projects',
    'project_memberships', 'project_activity', 'opportunities', 'focus_sessions',
    'notifications', 'integrations', 'sync_runs', 'user_preferences',
    'ai_conversations', 'ai_usage_events', 'ai_action_proposals'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end
$$;

-- profiles keys on `id`; everything else keys on `user_id`.
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

do $$
declare
  t text;
begin
  foreach t in array array[
    'courses', 'tasks', 'assignments', 'events', 'projects',
    'project_memberships', 'project_activity', 'opportunities', 'focus_sessions',
    'notifications', 'integrations', 'sync_runs', 'user_preferences',
    'ai_conversations', 'ai_usage_events', 'ai_action_proposals'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
    execute format(
      'create policy %I on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t || '_owner', t
    );
  end loop;
end
$$;

-- The anon role must never see private rows even if a policy is dropped later.
revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
