// Stripe webhook receiver. Deployed as a Supabase Edge Function so a fully
// static frontend (no server of its own) can still react to payment events.
//
// Deploy:   supabase functions deploy stripe-webhook --no-verify-jwt
// Secrets:  supabase secrets set STRIPE_SECRET_KEY=sk_... STRIPE_WEBHOOK_SECRET=whsec_...
// Stripe:   add an endpoint at https://<project-ref>.supabase.co/functions/v1/stripe-webhook
//           listening for: checkout.session.completed, customer.subscription.updated,
//           customer.subscription.deleted

import Stripe from "https://esm.sh/stripe@17.4.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Stripe's own recurring interval ("week" | "month" | "year") doubles as our
// plan name, so adding/changing prices in Stripe never requires touching
// this function.
function planFromInterval(interval: string | undefined): string {
  return interval ?? "month";
}

async function upsertFromSubscription(
  subscription: Stripe.Subscription,
  userId?: string | null,
) {
  const item = subscription.items.data[0];
  const price = item?.price;
  // Stripe moved current_period_end from the subscription itself down to
  // the subscription item as part of its 2025 Billing API changes; read
  // both spots so this keeps working regardless of the account's API
  // version (webhook payloads are shaped by the account/endpoint version,
  // not by the apiVersion this SDK client was created with).
  const periodEnd = (item as unknown as { current_period_end?: number })?.current_period_end
    ?? (subscription as unknown as { current_period_end?: number }).current_period_end;
  const expiresAt = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;
  const status = ["active", "trialing"].includes(subscription.status) ? "active" : "inactive";

  const row = {
    status,
    plan: planFromInterval(price?.recurring?.interval),
    expires_at: expiresAt,
    cancel_at: subscription.cancel_at ? new Date(subscription.cancel_at * 1000).toISOString() : null,
    stripe_customer_id: subscription.customer as string,
    stripe_subscription_id: subscription.id,
  };

  if (userId) {
    await supabase.from("subscriptions").upsert({ user_id: userId, ...row }, { onConflict: "user_id" });
  } else {
    await supabase.from("subscriptions").update(row).eq("stripe_subscription_id", subscription.id);
  }
}

Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature!, webhookSecret);
  } catch (err) {
    console.error("Signature verification failed:", err);
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id;
        if (session.subscription && userId) {
          const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
          await upsertFromSubscription(subscription, userId);
        }
        break;
      }
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await upsertFromSubscription(subscription);
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await supabase
          .from("subscriptions")
          .update({ status: "inactive" })
          .eq("stripe_subscription_id", subscription.id);
        break;
      }
    }
  } catch (err) {
    console.error(`Error handling ${event.type}:`, err);
    return new Response("Webhook handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
