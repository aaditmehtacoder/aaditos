-- Web push subscriptions.
--
-- One row per device per account: the same user signed in on a Chromebook and a
-- desktop has two, and both should be pushed. `endpoint` is unique because it is
-- the browser's own identifier for the subscription — re-subscribing on the same
-- device returns the same endpoint, so an upsert on it is what keeps this from
-- accumulating duplicates.
--
-- `p256dh` and `auth` are stored even though this app sends payload-less pushes.
-- They cost nothing, and without them switching to encrypted payloads later would
-- require every device to re-subscribe.

create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text,
  auth         text,
  -- Free-text label so a stale subscription is identifiable in the UI.
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Same shape as every other table here: you can only ever see your own rows.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'push_subscriptions'
      and policyname = 'push_subscriptions_owner'
  ) then
    execute 'create policy push_subscriptions_owner on public.push_subscriptions
             for all using (auth.uid() = user_id) with check (auth.uid() = user_id)';
  end if;
end
$$;
