"use client";

import { useEffect, useState } from "react";

import { dashboardFetch } from "../../../lib/dashboard-api";
import { useDashboardSession } from "../../../lib/dashboard-session";

type PaidTier = "pro" | "enterprise";

const plans: Array<{
  tier: PaidTier;
  title: string;
  price: string;
  usage: string;
  endpoints: string;
}> = [
  {
    tier: "pro",
    title: "Pro Team",
    price: "$29 / month",
    usage: "50,000 webhook requests per month",
    endpoints: "Up to 15 endpoints",
  },
  {
    tier: "enterprise",
    title: "Enterprise",
    price: "$79 / month",
    usage: "500,000 webhook requests per month",
    endpoints: "Unlimited endpoints",
  },
];

export default function BillingPage() {
  const { token, workspaceId } = useDashboardSession();
  const [busyTier, setBusyTier] = useState<PaidTier | "">("");
  const [error, setError] = useState("");
  const [checkoutComplete, setCheckoutComplete] = useState(false);

  useEffect(() => {
    setCheckoutComplete(new URLSearchParams(window.location.search).get("checkout") === "success");
  }, []);

  const startCheckout = async (tier: PaidTier) => {
    setBusyTier(tier);
    setError("");
    try {
      const result = await dashboardFetch<{ checkoutUrl: string }>(
        "/api/v1/billing/checkout",
        { token, workspaceId },
        { method: "POST", body: JSON.stringify({ tier }) },
      );
      const checkoutUrl = new URL(result.checkoutUrl);
      if (checkoutUrl.protocol !== "https:" || !checkoutUrl.hostname.endsWith(".lemonsqueezy.com")) {
        throw new Error("The checkout service returned an untrusted URL.");
      }
      window.location.assign(checkoutUrl.toString());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Checkout could not be started.");
      setBusyTier("");
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-7">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
          Workspace plan
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
          Grow when you need more coverage
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Start free, and upgrade this workspace through secure Lemon Squeezy
          checkout. Subscription changes apply after the signed billing event is
          confirmed.
        </p>
      </header>

      {checkoutComplete ? (
        <p role="status" className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-xs leading-5 text-emerald-600 dark:text-emerald-300">
          Checkout returned successfully. Your plan updates after Lemon Squeezy
          confirms the subscription event.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 text-xs leading-5 text-rose-500">
          {error}
        </p>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2">
        {plans.map((plan) => (
          <article key={plan.tier} className="rounded-2xl border border-line/80 bg-surface/70 p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-ink">{plan.title}</h2>
            <p className="mt-3 text-2xl font-semibold tracking-tight text-ink">{plan.price}</p>
            <ul className="mt-5 space-y-2 text-xs leading-5 text-muted">
              <li>{plan.usage}</li>
              <li>{plan.endpoints}</li>
              <li>Webhook signatures, incident rules and Slack alerts</li>
            </ul>
            <button
              type="button"
              onClick={() => void startCheckout(plan.tier)}
              disabled={Boolean(busyTier)}
              className="mt-6 w-full rounded-xl bg-accent px-4 py-3 text-xs font-semibold text-white transition hover:brightness-110 disabled:cursor-wait disabled:opacity-50"
            >
              {busyTier === plan.tier ? "Opening secure checkout…" : `Choose ${plan.title}`}
            </button>
          </article>
        ))}
      </section>

      <p className="text-[10px] leading-5 text-muted">
        Checkout availability depends on the workspace billing administrator
        and configured Lemon Squeezy products. Payment-provider transaction fees
        apply; SignalMend does not require a separate billing SDK subscription.
      </p>
    </div>
  );
}
