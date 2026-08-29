// Creates a Stripe Billing Portal session for the signed-in user, so they
// can cancel or manage their subscription without a custom cancel flow.
// Deploy: supabase functions deploy stripe-portal
// (no --no-verify-jwt here on purpose: Supabase checks the caller's auth
// token before this runs, so req.auth below is always the real user.)

import Stripe from "https://esm.sh/stripe@17.4.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});

const RETURN_URL = "https://geogushing.com/subscription";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), { status: 401, headers: jsonHeaders });
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
    .select("stripe_customer_id, stripe_subscription_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (subError || !sub?.stripe_customer_id) {
    return new Response(JSON.stringify({ error: "No Stripe customer on file for this account" }), { status: 404, headers: jsonHeaders });
  }

  // Optional { flow: "update" | "cancel" } body deep-links straight into the
  // matching Billing Portal screen instead of dropping the user on the
  // generic overview (requires that flow to be enabled in the Stripe
  // dashboard's portal configuration).
  let flow: string | undefined;
  try {
    const body = await req.json();
    flow = body?.flow;
  } catch {
    // no body sent — fall back to the generic portal
  }

  let flowData: Stripe.BillingPortal.SessionCreateParams.FlowData | undefined;
  if (sub.stripe_subscription_id && flow === "update") {
    flowData = {
      type: "subscription_update",
      subscription_update: { subscription: sub.stripe_subscription_id },
    };
  } else if (sub.stripe_subscription_id && flow === "cancel") {
    flowData = {
      type: "subscription_cancel",
      subscription_cancel: { subscription: sub.stripe_subscription_id },
    };
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: RETURN_URL,
    ...(flowData ? { flow_data: flowData } : {}),
  });

  return new Response(JSON.stringify({ url: session.url }), { headers: jsonHeaders });
});
