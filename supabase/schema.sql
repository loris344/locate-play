-- Full schema for the new Supabase project (ejdvrtflsvvylezymsft).
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

create extension if not exists pgcrypto;

-- PROFILES --------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Profiles are viewable by everyone"
  on public.profiles for select
  using (true);

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- VIDEOS ------------------------------------------------------------------
create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  video_url text not null,
  latitude double precision not null,
  longitude double precision not null,
  city text not null,
  country text not null,
  actor_name text,
  actor_photo_url text,
  source_url text,
  created_at timestamptz not null default now()
);

alter table public.videos enable row level security;

create policy "Videos are viewable by everyone"
  on public.videos for select
  using (true);

-- Writes (insert/update/delete) intentionally have no policy for
-- anon/authenticated: only the service_role key (used by the ingestion
-- script) can write, since it bypasses RLS entirely.

-- GAME_SCORES ---------------------------------------------------------------
create table if not exists public.game_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  total_score integer not null,
  created_at timestamptz not null default now()
);

alter table public.game_scores enable row level security;

create policy "Users can view their own scores"
  on public.game_scores for select
  using (auth.uid() = user_id);

create policy "Users can insert their own scores"
  on public.game_scores for insert
  with check (auth.uid() = user_id);

-- SUBSCRIPTIONS ---------------------------------------------------------------
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'inactive',
  plan text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

create policy "Users can view their own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);

-- Writes are expected from a trusted backend/webhook (e.g. Stripe) using
-- the service_role key, so no insert/update policy is granted here.

-- LEADERBOARD RPC ---------------------------------------------------------------
create or replace function public.get_leaderboard()
returns table (
  username text,
  total_score bigint,
  games_played bigint,
  last_played_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(p.username, 'Anonymous') as username,
    sum(gs.total_score)::bigint as total_score,
    count(*)::bigint as games_played,
    max(gs.created_at) as last_played_at
  from public.game_scores gs
  join public.profiles p on p.id = gs.user_id
  group by p.username
  order by total_score desc
  limit 50;
$$;

grant execute on function public.get_leaderboard() to anon, authenticated;
