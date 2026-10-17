-- Library items: one row per saved item, owned by a user.
-- Deleted (swipe-right) cards are never written here.

create type public.verdict as enum ('buy_now', 'wait', 'skip');
create type public.checkout_status as enum ('none', 'watching', 'purchased');

create table public.items (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at      timestamptz not null default now(),
  thumbnail_url   text not null,
  name            text not null,
  summary         text not null default '',
  score           int not null check (score between 0 and 100),
  subscores       jsonb not null,
  category        text not null,
  brand           text not null default '',
  model           text not null default '',
  verdict         public.verdict not null,
  best_listing    jsonb not null,
  target_price    numeric(10, 2),
  checkout_status public.checkout_status not null default 'none'
);

create index items_user_created_idx on public.items (user_id, created_at desc);
create index items_watching_idx on public.items (checkout_status) where checkout_status = 'watching';

alter table public.items enable row level security;

create policy "items_select_own" on public.items
  for select to authenticated using (user_id = auth.uid());
create policy "items_insert_own" on public.items
  for insert to authenticated with check (user_id = auth.uid());
create policy "items_update_own" on public.items
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "items_delete_own" on public.items
  for delete to authenticated using (user_id = auth.uid());

-- Realtime: lets the library see checkout_status flip to 'purchased' live.
alter publication supabase_realtime add table public.items;

-- Thumbnails bucket. Public read (paths contain unguessable uuids);
-- writes restricted to the caller's own {user_id}/ folder.
insert into storage.buckets (id, name, public)
values ('thumbnails', 'thumbnails', true)
on conflict (id) do nothing;

create policy "thumbnails_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'thumbnails' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "thumbnails_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'thumbnails' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "thumbnails_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'thumbnails' and (storage.foldername(name))[1] = auth.uid()::text);
