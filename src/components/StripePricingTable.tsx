import { Crown } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

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
  const { user } = useAuth();

  const getUrl = (baseUrl: string) => {
    if (!user) return baseUrl;
    const sep = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${sep}client_reference_id=${user.id}&prefilled_email=${encodeURIComponent(user.email || "")}`;
  };

  return (
    <div className="w-full grid grid-cols-1 md:grid-cols-3 gap-3">
      {PLANS.map((plan) => (
        <a
          key={plan.name}
          href={getUrl(plan.url)}
          target="_blank"
          rel="noopener noreferrer"
          className={`relative rounded-xl border-2 p-5 text-center transition-all hover:scale-[1.02] ${
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
  );
}
