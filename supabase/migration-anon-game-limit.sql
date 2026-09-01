-- Anonymous play had NO server-side quota at all: game-start's daily-limit
-- check only ran `if (user)` - an anonymous caller (or anyone hitting the
-- edge function directly, bypassing the frontend's localStorage-only "1
-- free game" check entirely) could start unlimited games forever. This adds
-- the column game-start needs to enforce a real per-IP daily cap for
-- anonymous sessions, matching how the signed-in 2/day quota already works
-- (counted at session-start, in the database, not client-side).
--
-- Stores a salted HMAC of the caller's IP, not the raw IP - enough to rate
-- limit without keeping directly-identifying data around. See
-- migration-anon-game-limit.sql's edge-function counterpart (game-start)
-- for how it's computed.
--
-- Run once in Supabase Dashboard -> SQL Editor, or via
-- `supabase db query --linked -f supabase/migration-anon-game-limit.sql`.
-- Safe to re-run.

alter table public.game_sessions add column if not exists client_ip_hash text;

create index if not exists game_sessions_anon_ip_idx
  on public.game_sessions (client_ip_hash, created_at)
  where user_id is null;
