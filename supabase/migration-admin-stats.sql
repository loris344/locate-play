-- Backs /admin: a dashboard restricted to a single hardcoded email, showing
-- real player stats (registered players, games played, retention, premium
-- conversion, top players) - never the fake_leaderboard_entries table.
--
-- The page itself only redirects a non-matching user away; that's UX, not
-- security. The frontend runs entirely client-side with the public anon
-- key (this is a static-export site, see next.config.ts: output "export" -
-- there is no server to gate a route on), so anyone could otherwise call
-- these RPCs directly. The actual gate is inside every function below:
-- each one re-checks the caller's own auth.users row (not a JWT claim,
-- which depends on provider/token shape - auth.uid() is always trustworthy
-- inside a security definer function) and raises rather than returning
-- partial data if it doesn't match.
--
-- Run in Supabase Dashboard -> SQL Editor. Safe to re-run.

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from auth.users where id = auth.uid() and email = 'lorisjsd@gmail.com'
  );
$$;

-- Not granted to anon: an admin is always signed in, so requiring
-- `authenticated` means a logged-out request fails before it even reaches
-- the is_admin() check.
grant execute on function public.is_admin() to authenticated;

-- OVERVIEW -----------------------------------------------------------------
-- One row of headline numbers for the top of the dashboard.
create or replace function public.admin_get_overview()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  result json;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  select json_build_object(
    'total_players', (select count(*) from public.profiles),
    'total_games_completed', (select count(*) from public.game_scores),
    'total_game_sessions', (select count(*) from public.game_sessions),
    'abandoned_sessions', (select count(*) from public.game_sessions where finished = false),
    'total_points_scored', (select coalesce(sum(total_score), 0) from public.game_scores),
    'avg_score_per_game', (select coalesce(round(avg(total_score)), 0) from public.game_scores),
    'active_subscribers', (
      select count(*) from public.subscriptions
      where status = 'active' and (expires_at is null or expires_at > now())
    ),
    'players_with_multiple_games', (
      select count(*) from (
        select user_id from public.game_scores group by user_id having count(*) > 1
      ) t
    ),
    'signups_last_7d', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'signups_last_30d', (select count(*) from auth.users where created_at > now() - interval '30 days'),
    'games_last_7d', (select count(*) from public.game_sessions where created_at > now() - interval '7 days'),
    'games_last_30d', (select count(*) from public.game_sessions where created_at > now() - interval '30 days'),
    'dau', (
      select count(distinct user_id) from public.game_sessions
      where created_at > now() - interval '1 day' and user_id is not null
    ),
    'wau', (
      select count(distinct user_id) from public.game_sessions
      where created_at > now() - interval '7 days' and user_id is not null
    ),
    'mau', (
      select count(distinct user_id) from public.game_sessions
      where created_at > now() - interval '30 days' and user_id is not null
    ),
    'total_videos', (select count(*) from public.videos)
  ) into result;

  return result;
end;
$$;

grant execute on function public.admin_get_overview() to authenticated;

-- DAILY ACTIVITY -------------------------------------------------------------
-- One row per day for the last `days` days (zero-filled, so a quiet day
-- still shows up as 0 instead of a gap), for the activity chart.
create or replace function public.admin_get_daily_activity(days integer default 30)
returns table (
  day date,
  signups bigint,
  games_started bigint,
  games_completed bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  return query
  with days_series as (
    select generate_series(current_date - (days - 1), current_date, interval '1 day')::date as d
  )
  select
    ds.d as day,
    coalesce((select count(*) from auth.users u where u.created_at::date = ds.d), 0)::bigint as signups,
    coalesce((select count(*) from public.game_sessions gs where gs.created_at::date = ds.d), 0)::bigint as games_started,
    coalesce((select count(*) from public.game_scores gsc where gsc.created_at::date = ds.d), 0)::bigint as games_completed
  from days_series ds
  order by ds.d;
end;
$$;

grant execute on function public.admin_get_daily_activity(integer) to authenticated;

-- TOP PLAYERS ----------------------------------------------------------------
-- Real players only (joined from profiles/game_scores), ranked by games
-- played - fake_leaderboard_entries never enters this query.
create or replace function public.admin_get_top_players(row_limit integer default 100)
returns table (
  user_id uuid,
  username text,
  email text,
  avatar_url text,
  games_played bigint,
  total_score bigint,
  avg_score numeric,
  best_score bigint,
  last_played_at timestamptz,
  joined_at timestamptz,
  is_premium boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  return query
  select
    p.id as user_id,
    p.username,
    u.email::text as email,
    p.avatar_url,
    count(gs.id)::bigint as games_played,
    coalesce(sum(gs.total_score), 0)::bigint as total_score,
    coalesce(round(avg(gs.total_score)), 0) as avg_score,
    coalesce(max(gs.total_score), 0)::bigint as best_score,
    max(gs.created_at) as last_played_at,
    p.created_at as joined_at,
    coalesce(bool_or(s.status = 'active' and (s.expires_at is null or s.expires_at > now())), false) as is_premium
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.game_scores gs on gs.user_id = p.id
  left join public.subscriptions s on s.user_id = p.id
  group by p.id, p.username, u.email, p.avatar_url, p.created_at
  order by games_played desc, total_score desc
  limit row_limit;
end;
$$;

grant execute on function public.admin_get_top_players(integer) to authenticated;
