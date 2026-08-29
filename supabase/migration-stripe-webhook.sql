-- Run once in Supabase Dashboard -> SQL Editor.
-- Adds the columns the Stripe webhook needs to match a subscription event
-- back to a user, and enforces one subscription row per user so upserts
-- from the webhook can't create duplicates.

alter table public.subscriptions add column if not exists stripe_customer_id text;
alter table public.subscriptions add column if not exists stripe_subscription_id text;

alter table public.subscriptions
  drop constraint if exists subscriptions_user_id_key;
alter table public.subscriptions
  add constraint subscriptions_user_id_key unique (user_id);

create unique index if not exists subscriptions_stripe_subscription_id_key
  on public.subscriptions (stripe_subscription_id)
  where stripe_subscription_id is not null;
