"use client";

import { AlertTriangle, Clock, LifeBuoy, Lock } from "lucide-react";
import Link from "next/link";

import { useOrganization } from "@/components/providers/organization-provider";
import { useSubscription } from "@/features/subscription/api";
import { cn, formatDateTime } from "@/lib/utils";

/** One line above every dashboard page: support access, or the subscription needing attention. */
export function StatusBanner() {
  const { current, can } = useOrganization();
  const support = current.support_until;
  const subscription = useSubscription(!support);

  if (support) {
    return (
      <Banner tone="info" icon={LifeBuoy}>
        You&apos;re viewing <strong>{current.organization.name}</strong> as Nexora support. Read-only, until{" "}
        {formatDateTime(support, current.organization.timezone)}. Everything you open is in their audit log.{" "}
        <Link className="font-medium underline" href="/platform">Back to the platform console</Link>
      </Banner>
    );
  }
  const s = subscription.data;
  if (!s || s.complimentary) return null;
  const action = can("subscription.manage") ? (
    <Link className="font-medium underline" href="/dashboard/settings/subscription">
      {s.status === "trialing" ? "Choose a plan" : "Pay now"}
    </Link>
  ) : (
    <span>Ask an owner of {current.organization.name} to pay.</span>
  );
  if (s.read_only) {
    return (
      <Banner tone="danger" icon={Lock}>
        <strong>Nexora is read-only.</strong> Your subscription payment is overdue, so changes are blocked. {action}
      </Banner>
    );
  }
  if (s.status === "past_due") {
    return (
      <Banner tone="warning" icon={AlertTriangle}>
        <strong>Your Nexora payment is overdue.</strong> Pay soon to avoid Nexora becoming read-only. {action}
      </Banner>
    );
  }
  if (s.status === "trialing" && s.days_left !== null && s.days_left <= 7) {
    return (
      <Banner tone="info" icon={Clock}>
        Your free trial ends {s.days_left <= 0 ? "today" : `in ${s.days_left} day${s.days_left === 1 ? "" : "s"}`}. {action}
      </Banner>
    );
  }
  return null;
}

function Banner({ tone, icon: Icon, children }: { tone: "info" | "warning" | "danger"; icon: typeof Lock; children: React.ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-2 border-b px-4 py-2.5 text-sm sm:px-6 lg:px-8 print:hidden",
        tone === "info" && "border-primary/20 bg-primary/5",
        tone === "warning" && "border-warning/40 bg-warning/10",
        tone === "danger" && "border-destructive/30 bg-destructive/10",
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>{children}</p>
    </div>
  );
}
