"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Privacy() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-2xl mx-auto space-y-6 pb-16">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push("/")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-3xl font-black text-gradient-hot">PRIVACY POLICY</h1>
        </div>

        <div className="space-y-6 text-sm text-foreground leading-relaxed">
          <p className="text-muted-foreground">Last updated: August 2026</p>

          <p>
            GeoGushing (&quot;we&quot;, &quot;us&quot;) operates geogushing.com, a location-guessing game. This page
            explains what data we collect, why, and how you can control it. GeoGushing is for users 18 years and
            older only.
          </p>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-foreground">Data we collect</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <span className="font-semibold">Account data:</span> email address, and if you sign in with Google,
                the basic profile info Google shares (name, email, avatar).
              </li>
              <li>
                <span className="font-semibold">Profile data you provide:</span> username, avatar, and optionally
                your Instagram / Facebook handles if you choose to add them.
              </li>
              <li>
                <span className="font-semibold">Gameplay data:</span> your scores and number of games played, used
                to run the leaderboard.
              </li>
              <li>
                <span className="font-semibold">Payment data:</span> if you subscribe, payment is processed by
                Stripe. We never see or store your card details - only your subscription status.
              </li>
              <li>
                <span className="font-semibold">Analytics data:</span> pages visited and product usage, collected
                via PostHog (EU-hosted, no session recording). If you arrive from a TikTok ad, the TikTok Pixel
                records that for ad performance measurement.
              </li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-foreground">Who we share it with</h2>
            <p>
              We use a small number of service providers to run GeoGushing: Supabase (hosting, authentication,
              database), Stripe (payment processing), Google (optional sign-in), PostHog (product analytics), and
              TikTok (ad measurement, only if you arrived via a TikTok ad). We don&apos;t sell your data to anyone.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-foreground">Your rights</h2>
            <p>
              You can update your username, avatar, and social handles anytime from your account page. To access,
              correct, or delete your data, contact us at{" "}
              <a href="mailto:lorisjsd@gmail.com" className="text-primary underline">
                lorisjsd@gmail.com
              </a>
              . We&apos;ll respond within a reasonable timeframe.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-foreground">Cookies</h2>
            <p>
              We use cookies for authentication (keeping you signed in) and analytics (understanding product usage).
              You can block cookies in your browser, though this may break sign-in.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-foreground">Changes</h2>
            <p>
              We may update this policy as the product evolves. Material changes will be reflected by updating the
              date at the top of this page.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-foreground">Contact</h2>
            <p>
              Questions about this policy?{" "}
              <a href="mailto:lorisjsd@gmail.com" className="text-primary underline">
                lorisjsd@gmail.com
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
