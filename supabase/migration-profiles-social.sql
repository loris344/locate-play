-- Run once in Supabase Dashboard -> SQL Editor.
-- Adds profile fields (avatar, Instagram, Facebook, leaderboard visibility toggle),
-- an "avatars" storage bucket with per-user RLS, and updates get_leaderboard()
-- to expose them. Safe to re-run.

alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists instagram_handle text;
alter table public.profiles add column if not exists facebook_handle text;
alter table public.profiles add column if not exists show_social boolean not null default false;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

do $$ begin
  create policy "Avatars are publicly readable"
    on storage.objects for select
    using (bucket_id = 'avatars');
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Users can upload their own avatar"
    on storage.objects for insert
    with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Users can update their own avatar"
    on storage.objects for update
    using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Users can delete their own avatar"
    on storage.objects for delete
    using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);
exception when duplicate_object then null;
end $$;

drop function if exists public.get_leaderboard();

create or replace function public.get_leaderboard()
returns table (
  username text,
  total_score bigint,
  games_played bigint,
  last_played_at timestamptz,
  avatar_url text,
  instagram_handle text,
  facebook_handle text
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
    case when p.show_social then p.facebook_handle else null end as facebook_handle
  from public.game_scores gs
  join public.profiles p on p.id = gs.user_id
  group by p.username, p.avatar_url, p.show_social, p.instagram_handle, p.facebook_handle
  order by total_score desc
  limit 50;
$$;

grant execute on function public.get_leaderboard() to anon, authenticated;
