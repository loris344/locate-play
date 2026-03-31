import { useEffect, useRef } from "react";
import { Crown } from "lucide-react";

const PLANS = [
  {
    name: "Monthly",
    price: "$5.90",
    period: "/month",
    url: "https://buy.stripe.com/test_14AfZhbkX4ZR1WnaIhcZa00",
  },
  {
    name: "Quarterly",
    price: "$15",
    period: "/3 months",
    badge: "POPULAR",
    url: "https://buy.stripe.com/test_dRm5kDagT9g7bwX9EdcZa01",
  },
  {
    name: "Yearly",
    price: "$55",
    period: "/year",
    badge: "BEST VALUE",
    url: "https://buy.stripe.com/test_7sY8wP3SvakbasTaIhcZa02",
  },
];

export default function StripePricingTable() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!document.querySelector('script[src="https://js.stripe.com/v3/pricing-table.js"]')) {
      const script = document.createElement("script");
      script.src = "https://js.stripe.com/v3/pricing-table.js";
      script.async = true;
      document.body.appendChild(script);
    }

    if (containerRef.current) {
      containerRef.current.innerHTML = "";
      const el = document.createElement("stripe-pricing-table");
      el.setAttribute("pricing-table-id", "prctbl_1TH1mMGxRwR5OjMT5TlwsDZf");
      el.setAttribute(
        "publishable-key",
        "pk_test_51TH15hGxRwR5OjMTKbMwEepA3ww5XKmUSimKNa8jWhoy35Zv2GzZ0914oSpKPpwASrksruRs98cMlewLTCLKLgRB00UgIEaiaJ"
      );
      containerRef.current.appendChild(el);
    }
  }, []);

  return (
    <div className="w-full">
      {/* Mobile: custom cards */}
      <div className="md:hidden grid grid-cols-1 gap-3">
        {PLANS.map((plan) => (
          <a
            key={plan.name}
            href={plan.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`relative rounded-xl border-2 p-4 text-center transition-all hover:scale-[1.02] ${
              plan.badge === "POPULAR"
                ? "border-primary bg-primary/10"
                : "border-border bg-card"
            }`}
          >
            {plan.badge && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs font-black px-3 py-1 rounded-full">
                {plan.badge}
              </span>
            )}
            <Crown className="w-6 h-6 text-secondary mx-auto mb-2" />
            <p className="font-black text-lg text-foreground">{plan.name}</p>
            <p className="text-2xl font-black text-gradient-hot">
              {plan.price}
              <span className="text-sm text-muted-foreground font-normal">{plan.period}</span>
            </p>
            <p className="text-xs text-muted-foreground mt-1">Unlimited games</p>
          </a>
        ))}
      </div>

      {/* Desktop: Stripe embedded pricing table */}
      <div ref={containerRef} className="hidden md:block w-full" />
    </div>
  );
}
