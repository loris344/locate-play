// Switches the signed-in user's subscription to a different plan in
// place, instead of sending them through Stripe Checkout again — which
// would just create a second, separate subscription rather than
// replacing the existing one.
// Deploy: supabase functions deploy stripe-change-plan
//
// Weekly/Monthly/Yearly are three separate Stripe Products (not three
// Prices on one Product), so the target price can't be found by listing
// prices on the current subscription's product. Instead we resolve each
// plan's price the same way the pricing page identifies it: via its
// Payment Link URL (kept in sync with src/components/StripePricingTable.tsx).

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

// Keep in sync with the `url` fields in src/components/StripePricingTable.tsx.
const PAYMENT_LINK_URLS: Record<string, string> = {
  week: "https://buy.stripe.com/00waEQ8AY697ffp7a27EQ02",
  month: "https://buy.stripe.com/eVqfZadVibtrd7h9ia7EQ01",
  year: "https://buy.stripe.com/00w00cbNa40ZaZ9ame7EQ00",
};

async function priceIdForInterval(interval: string): Promise<string | null> {
  const url = PAYMENT_LINK_URLS[interval];
  if (!url) return null;

  const links = await stripe.paymentLinks.list({ limit: 100 });
  const link = links.data.find((l) => l.url === url);
  if (!link) return null;

  const lineItems = await stripe.paymentLinks.listLineItems(link.id, { limit: 1 });
  const price = lineItems.data[0]?.price;
  if (!price) return null;
  return typeof price === "string" ? price : price.id;
}

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
  if (typeof interval !== "string" || !PAYMENT_LINK_URLS[interval]) {
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

  const targetPriceId = await priceIdForInterval(interval);
  if (!targetPriceId) {
    return new Response(JSON.stringify({ error: "That plan is not available" }), { status: 404, headers: jsonHeaders });
  }

  if (item.price.id === targetPriceId) {
    return new Response(JSON.stringify({ error: "Already on this plan" }), { status: 400, headers: jsonHeaders });
  }

  await stripe.subscriptions.update(sub.stripe_subscription_id, {
    items: [{ id: item.id, price: targetPriceId }],
    proration_behavior: "create_prorations",
  });

  return new Response(JSON.stringify({ success: true }), { headers: jsonHeaders });
});
