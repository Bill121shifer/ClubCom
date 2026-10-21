create table public.announcements (
  id bigint generated always as identity primary key,
  author_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  title text not null check (char_length(trim(title)) between 1 and 120),
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table public.calendar_events (
  id bigint generated always as identity primary key,
  author_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  title text not null check (char_length(trim(title)) between 1 and 120),
  details text not null default '' check (char_length(trim(details)) <= 2000),
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);

create index announcements_created_at_idx on public.announcements (created_at desc);
create index announcements_author_id_idx on public.announcements (author_id);
create index calendar_events_starts_at_idx on public.calendar_events (starts_at);
create index calendar_events_author_id_idx on public.calendar_events (author_id);
alter table public.announcements enable row level security;
alter table public.calendar_events enable row level security;

create policy "authenticated users read announcements" on public.announcements for select to authenticated using (true);
create policy "users create announcements" on public.announcements for insert to authenticated with check ((select auth.uid()) = author_id);
create policy "users update own announcements" on public.announcements for update to authenticated using ((select auth.uid()) = author_id) with check ((select auth.uid()) = author_id);
create policy "users delete own announcements" on public.announcements for delete to authenticated using ((select auth.uid()) = author_id);
create policy "authenticated users read events" on public.calendar_events for select to authenticated using (true);
create policy "users create events" on public.calendar_events for insert to authenticated with check ((select auth.uid()) = author_id);
create policy "users update own events" on public.calendar_events for update to authenticated using ((select auth.uid()) = author_id) with check ((select auth.uid()) = author_id);
create policy "users delete own events" on public.calendar_events for delete to authenticated using ((select auth.uid()) = author_id);
alter publication supabase_realtime add table public.announcements;
alter publication supabase_realtime add table public.calendar_events;
