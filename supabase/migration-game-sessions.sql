-- Backs the game-start / submit-round edge functions: a session is created
-- (and counted toward the signed-in daily quota) the moment a game starts,
-- not when it's completed, and holds the running score that submit-round
-- verifies server-side instead of trusting whatever a client posts.
--
-- Only the service role key (used exclusively by the edge functions) can
-- insert or update rows. Signed-in users may only read their own rows,
-- needed so the frontend can show "X/2 free games used today" without a
-- round trip through an edge function.

create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  video_ids uuid[] not null,
  -- Videos already scored in this session, so submit-round can reject a
  -- replayed call for the same round instead of adding the score again.
  scored_video_ids uuid[] not null default '{}',
  rounds_completed integer not null default 0,
  total_score integer not null default 0,
  finished boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.game_sessions enable row level security;

create policy "Users can view their own game sessions"
  on public.game_sessions for select
  using (auth.uid() = user_id);

create index if not exists game_sessions_user_created_idx
  on public.game_sessions (user_id, created_at);
