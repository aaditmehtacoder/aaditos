-- Notes: a thought or an idea, attached to a class.
--
-- The gap this fills: a planner can hold "write the essay by Friday" but has
-- nowhere for "Robson said the thesis has to be arguable" or "what if the
-- Financial Lit project used Origami Prep's pricing". Neither is a task and
-- neither has a date, so a todo list either loses them or invents a fake
-- deadline for them. They belong to the class, not to the calendar.
--
-- `task_id` records that a note was turned into a task, so the same idea can
-- never become two tasks. It is nulled if that task is deleted rather than
-- taking the note with it — the thought outlives the todo.

create table if not exists public.notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  course_id  uuid references public.courses (id) on delete cascade,
  kind       text not null default 'thought' check (kind in ('thought', 'idea')),
  body       text not null,
  task_id    uuid references public.tasks (id) on delete set null,
  pinned     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The class page reads every note for one course, newest first; the Today page
-- reads recent notes across all of them. Both are covered by this.
create index if not exists notes_user_course_idx
  on public.notes (user_id, course_id, created_at desc);

drop trigger if exists notes_updated_at on public.notes;
create trigger notes_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at();

-- Same protection as every other table: enabled *and* forced, so not even the
-- table owner bypasses the policy.
alter table public.notes enable row level security;
alter table public.notes force row level security;

drop policy if exists notes_owner on public.notes;
create policy notes_owner on public.notes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

revoke all on public.notes from anon;
grant select, insert, update, delete on public.notes to authenticated;
