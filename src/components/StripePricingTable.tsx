import { useEffect, useRef } from "react";

export default function StripePricingTable() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load Stripe pricing table script if not already loaded
    if (!document.querySelector('script[src="https://js.stripe.com/v3/pricing-table.js"]')) {
      const script = document.createElement("script");
      script.src = "https://js.stripe.com/v3/pricing-table.js";
      script.async = true;
      document.body.appendChild(script);
    }

    // Create the custom element
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

  return <div ref={containerRef} className="w-full" />;
}
