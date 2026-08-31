"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Terms() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-2xl mx-auto space-y-6 pb-16">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push("/")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-3xl font-black text-gradient-hot">TERMS OF USE</h1>
        </div>

        <div className="space-y-6 text-sm text-foreground leading-relaxed">
          <p className="text-muted-foreground">Last updated: August 2026</p>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-foreground">Age requirement</h2>
            <p>
              GeoGushing is for users 18 years of age or older only. By using the site, you confirm you meet this
              requirement.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-foreground">The game</h2>
            <p>
              GeoGushing is a location-guessing game: you watch a short clip and guess where it was filmed. All
              content on the site is stream-safe (no explicit material). Scores are calculated server-side based on
              guess accuracy and speed, and may appear on the public leaderboard alongside your chosen username.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-foreground">Accounts</h2>
            <p>
              You&apos;re responsible for the accuracy of the information you provide and for keeping your account
              secure. Usernames and avatars may be changed from your account page, subject to a cooldown period on
              username changes. We may suspend accounts used to abuse, cheat, or interfere with the game or other
              players.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-foreground">Subscriptions and payments</h2>
            <p>
              Paid subscriptions are billed and processed by Stripe. Pricing is shown before you subscribe.
              Subscriptions renew automatically until cancelled from your account page; cancelling stops future
              billing but doesn&apos;t retroactively refund the current billing period unless required by law.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-foreground">Acceptable use</h2>
            <p>
              Don&apos;t attempt to bypass the game&apos;s scoring, automate gameplay, scrape the site, or use it in
              any way that violates applicable law.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-foreground">Changes</h2>
            <p>
              We may update these terms as the product evolves. Material changes will be reflected by updating the
              date at the top of this page. Continued use after a change means you accept the updated terms.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-foreground">Contact</h2>
            <p>
              Questions about these terms?{" "}
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
