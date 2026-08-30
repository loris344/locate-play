-- Run once in Supabase Dashboard -> SQL Editor.
-- Adds an is_premium flag to get_leaderboard(), true when the user has a
-- subscriptions row with status = 'active' and not expired - the same rule
-- useGameAccess.ts uses client-side to gate game access. Safe to re-run.

drop function if exists public.get_leaderboard();

create or replace function public.get_leaderboard()
returns table (
  username text,
  total_score bigint,
  games_played bigint,
  last_played_at timestamptz,
  avatar_url text,
  instagram_handle text,
  facebook_handle text,
  is_premium boolean
)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(p.username, 'Anonymous') as username,
    sum(gs.total_score)::bigint as total_score,
    count(*)::bigint as games_played,
    max(gs.created_at) as last_played_at,
    p.avatar_url,
    case when p.show_social then p.instagram_handle else null end as instagram_handle,
    case when p.show_social then p.facebook_handle else null end as facebook_handle,
    coalesce(bool_or(s.status = 'active' and (s.expires_at is null or s.expires_at > now())), false) as is_premium
  from public.game_scores gs
  join public.profiles p on p.id = gs.user_id
  left join public.subscriptions s on s.user_id = gs.user_id
  group by p.username, p.avatar_url, p.show_social, p.instagram_handle, p.facebook_handle
  order by total_score desc
  limit 50;
$$;

grant execute on function public.get_leaderboard() to anon, authenticated;
