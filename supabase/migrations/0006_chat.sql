-- Conversations with the assistant, and files for them.
--
-- A chat is one row: its messages as JSON, each carrying file *references*
-- into the attachments bucket rather than bytes. Owner-only, like everything
-- else. The bucket learns to hold PDFs and grows to 25 MB a file so a whole
-- textbook chapter can be attached; images are still downscaled in the
-- browser before they get here.

create table if not exists public.chats (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'New chat',
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chats_user_updated_idx on public.chats (user_id, updated_at desc);

alter table public.chats enable row level security;

drop policy if exists chats_owner_select on public.chats;
create policy chats_owner_select on public.chats
  for select to authenticated using (user_id = auth.uid());

drop policy if exists chats_owner_insert on public.chats;
create policy chats_owner_insert on public.chats
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists chats_owner_update on public.chats;
create policy chats_owner_update on public.chats
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists chats_owner_delete on public.chats;
create policy chats_owner_delete on public.chats
  for delete to authenticated using (user_id = auth.uid());

-- PDFs, and room for them. (Also applied through the Storage API on
-- 2026-10-27; kept here so a fresh project gets the same bucket.)
update storage.buckets
  set file_size_limit = 26214400,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
  where id = 'attachments';
