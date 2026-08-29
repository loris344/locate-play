-- Run once in Supabase Dashboard -> SQL Editor.
-- Lets users change their username from the account page, but enforces a
-- 30-day cooldown at the database level (not just client-side) so the rule
-- can't be bypassed by calling the API directly.

alter table public.profiles add column if not exists username_updated_at timestamptz;

create or replace function public.enforce_username_cooldown()
returns trigger
language plpgsql
as $$
begin
  if new.username is distinct from old.username then
    if old.username_updated_at is not null and old.username_updated_at > now() - interval '30 days' then
      raise exception 'You can only change your username once every 30 days';
    end if;
    new.username_updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_username_cooldown on public.profiles;
create trigger trg_username_cooldown
  before update on public.profiles
  for each row
  execute function public.enforce_username_cooldown();
