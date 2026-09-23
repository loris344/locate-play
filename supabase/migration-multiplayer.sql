-- Backs /multiplayer: rooms run on a Cloudflare Worker + Durable Object
-- (workers/multiplayer), which writes one game_sessions row per player when
-- a multiplayer game starts - the same "counted at start, not at finish"
-- rule as solo games - and one game_scores row per player when it ends.
--
-- mode tells the two daily quotas apart: a free account gets 1 solo game
-- and 1 multiplayer game per day. game-start and useGameAccess.ts only
-- count mode = 'solo'; the multiplayer Worker only counts mode = 'multi'.
--
-- quota_exempt is set on multiplayer sessions whose room was hosted by a
-- Premium player: those games are unlimited for everyone in the room, so
-- they never count toward a free player's daily multiplayer game.
--
-- Run: supabase db query --linked -f supabase/migration-multiplayer.sql
-- Safe to re-run.

alter table public.game_sessions add column if not exists mode text not null default 'solo';
alter table public.game_sessions add column if not exists quota_exempt boolean not null default false;
alter table public.game_sessions add column if not exists room_code text;

do $$ begin
  alter table public.game_sessions
    add constraint game_sessions_mode_check check (mode in ('solo', 'multi'));
exception when duplicate_object then null;
end $$;

create index if not exists game_sessions_user_mode_created_idx
  on public.game_sessions (user_id, mode, created_at);
