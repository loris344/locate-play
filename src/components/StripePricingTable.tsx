import { Crown } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const PLANS = [
  {
    name: "Weekly",
    price: "$5.99",
    period: "/week",
    url: "https://buy.stripe.com/00waEQ8AY697ffp7a27EQ02",
  },
  {
    name: "Monthly",
    price: "$14",
    period: "/month",
    badge: "POPULAR",
    url: "https://buy.stripe.com/eVqfZadVibtrd7h9ia7EQ01",
  },
  {
    name: "Yearly",
    price: "$120",
    period: "/year",
    badge: "BEST VALUE",
    url: "https://buy.stripe.com/00w00cbNa40ZaZ9ame7EQ00",
  },
];

export default function StripePricingTable({ currentPlanLabel }: { currentPlanLabel?: string | null }) {
  const { user } = useAuth();

  const getUrl = (baseUrl: string) => {
    if (!user) return baseUrl;
    const sep = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${sep}client_reference_id=${user.id}&prefilled_email=${encodeURIComponent(user.email || "")}`;
  };

  return (
    <div className="w-full grid grid-cols-1 md:grid-cols-3 gap-3">
      {PLANS.map((plan) => {
        const isCurrent = plan.name === currentPlanLabel;
        return (
          <a
            key={plan.name}
            href={isCurrent ? undefined : getUrl(plan.url)}
            target={isCurrent ? undefined : "_blank"}
            rel={isCurrent ? undefined : "noopener noreferrer"}
            aria-disabled={isCurrent}
            className={`relative rounded-xl border-2 p-5 text-center transition-all ${
              isCurrent
                ? "border-green-500 bg-green-500/10 cursor-default"
                : `hover:scale-[1.02] ${plan.badge === "POPULAR" ? "border-primary bg-primary/10" : "border-border bg-card"}`
            }`}
          >
            {plan.badge && !isCurrent && (
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
            <p className="text-xs text-muted-foreground mt-1">
              {isCurrent ? "Current plan" : "Unlimited games"}
            </p>
          </a>
        );
      })}
    </div>
  );
}
