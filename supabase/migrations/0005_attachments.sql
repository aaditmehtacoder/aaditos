-- Images on tasks and notes.
--
-- A photo of the assignment sheet is often the whole assignment, and a photo
-- of the whiteboard is often the only record of what the teacher said. Each
-- record carries a small list of attachment metadata; the bytes live in a
-- private Storage bucket under the owner's id, so a workspace load never pulls
-- a semester of photos along with it.

alter table public.tasks add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table public.notes add column if not exists attachments jsonb not null default '[]'::jsonb;

-- The bucket. Private: every read goes through a signed URL the owner asked for.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Owner-only, decided by the first path segment: `<user id>/<file>`.
drop policy if exists attachments_owner_select on storage.objects;
create policy attachments_owner_select on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists attachments_owner_insert on storage.objects;
create policy attachments_owner_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists attachments_owner_update on storage.objects;
create policy attachments_owner_update on storage.objects
  for update to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists attachments_owner_delete on storage.objects;
create policy attachments_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
