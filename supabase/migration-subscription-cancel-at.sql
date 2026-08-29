-- Run once in Supabase Dashboard -> SQL Editor.
-- Tracks a pending cancellation date (Stripe's `cancel_at`) so the app can
-- show "Cancels on X" instead of "Renews on X" once a customer cancels via
-- the Billing Portal but still has access until the period ends.

alter table public.subscriptions add column if not exists cancel_at timestamptz;
