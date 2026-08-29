// Switches the signed-in user's subscription to a different billing
// interval (week/month/year) in place, instead of sending them through
// Stripe Checkout again — which would just create a second, separate
// subscription rather than replacing the existing one.
// Deploy: supabase functions deploy stripe-change-plan
//
// Assumes the weekly/monthly/yearly plans are three recurring Prices on
// the SAME Stripe Product (this is what the account is set up as: see
// stripe-webhook's planFromInterval, which already treats the recurring
// interval as the plan identity). If that ever changes, the price lookup
// below needs to change too.

import Stripe from "https://esm.sh/stripe@17.4.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VALID_INTERVALS = new Set(["week", "month", "year"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), { status: 401, headers: jsonHeaders });
  }

  const { interval } = await req.json().catch(() => ({ interval: undefined }));
  if (typeof interval !== "string" || !VALID_INTERVALS.has(interval)) {
    return new Response(JSON.stringify({ error: "Invalid plan" }), { status: 400, headers: jsonHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: "Invalid session" }), { status: 401, headers: jsonHeaders });
  }

  const { data: sub, error: subError } = await supabase
    .from("subscriptions")
    .select("stripe_subscription_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (subError || !sub?.stripe_subscription_id) {
    return new Response(JSON.stringify({ error: "No active subscription on file for this account" }), { status: 404, headers: jsonHeaders });
  }

  const subscription = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
  const item = subscription.items.data[0];
  if (!item) {
    return new Response(JSON.stringify({ error: "Subscription has no billing item" }), { status: 400, headers: jsonHeaders });
  }

  if (item.price.recurring?.interval === interval) {
    return new Response(JSON.stringify({ error: "Already on this plan" }), { status: 400, headers: jsonHeaders });
  }

  const productId = typeof item.price.product === "string" ? item.price.product : item.price.product.id;
  const prices = await stripe.prices.list({ product: productId, active: true, type: "recurring" });
  const targetPrice = prices.data.find((p) => p.recurring?.interval === interval);

  if (!targetPrice) {
    return new Response(JSON.stringify({ error: "That plan is not available" }), { status: 404, headers: jsonHeaders });
  }

  await stripe.subscriptions.update(sub.stripe_subscription_id, {
    items: [{ id: item.id, price: targetPrice.id }],
    proration_behavior: "create_prorations",
  });

  return new Response(JSON.stringify({ success: true }), { headers: jsonHeaders });
});
