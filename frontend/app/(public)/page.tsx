import {
  BarChart3,
  Building2,
  CreditCard,
  Lock,
  ShieldCheck,
  ShoppingCart,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Module {
  name: string;
  description: string;
  icon: LucideIcon;
  status: "available" | "next" | "planned";
}

// Honest status for each module. Update as phases ship.
const MODULES: Module[] = [
  {
    name: "Nexora Platform",
    description:
      "Secure accounts, organizations, team roles and permissions, and a tamper-proof audit trail.",
    icon: ShieldCheck,
    status: "available",
  },
  {
    name: "Nexora Property",
    description:
      "Properties, units, tenants, leases, configurable charges, maintenance and move-outs.",
    icon: Building2,
    status: "next",
  },
  {
    name: "Nexora Pay",
    description:
      "Landlord-specific M-Pesa and bank configurations, receipts, allocation and reconciliation.",
    icon: CreditCard,
    status: "planned",
  },
  {
    name: "Nexora Finance",
    description: "Expenses, supplier bills, deposits held separately, and clean financial records.",
    icon: Wallet,
    status: "planned",
  },
  {
    name: "Nexora Insights",
    description: "Collection rates, occupancy, arrears, profit and loss, and year-on-year reports.",
    icon: BarChart3,
    status: "planned",
  },
  {
    name: "Nexora POS",
    description: "Sales, inventory and customer accounts on the same shared platform.",
    icon: ShoppingCart,
    status: "planned",
  },
];

const STATUS_BADGE = {
  available: { label: "Available", variant: "accent" },
  next: { label: "In development", variant: "warning" },
  planned: { label: "Planned", variant: "muted" },
} as const;

export default function LandingPage() {
  return (
    <>
      <section className="relative overflow-hidden bg-primary text-primary-foreground">
        <div
          aria-hidden
          className="absolute -right-32 -top-32 size-[28rem] rounded-full bg-accent/20 blur-3xl"
        />
        <div className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <Badge className="mb-6 bg-white/10 text-white">All-in-one business management</Badge>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
            Run your whole business from one dependable place.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-white/80">
            Nexora brings operations, payments and reporting together, starting with property
            management for landlords and managers in Kenya, with KSh, M-Pesa and local workflows
            built in.
          </p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg" variant="accent">
              <Link href="/register">Create your workspace</Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-white/30 bg-transparent text-white hover:bg-white/10"
            >
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight">One platform, many modules</h2>
          <p className="mt-3 text-muted-foreground">
            Every module shares the same secure foundation: your team, roles and data stay in one
            place, and each organization&apos;s records are strictly isolated.
          </p>
        </div>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => {
            const badge = STATUS_BADGE[m.status];
            return (
              <div key={m.name} className="rounded-xl border bg-card p-6 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="rounded-lg bg-primary/5 p-2.5">
                    <m.icon className="size-5 text-primary" aria-hidden />
                  </div>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </div>
                <h3 className="mt-4 font-semibold">{m.name}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{m.description}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="border-t bg-muted/40">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:grid-cols-3 sm:px-6">
          {[
            {
              icon: Lock,
              title: "Isolated by design",
              body: "Every request is checked against your organization membership on the server.",
            },
            {
              icon: Users,
              title: "Roles that fit real teams",
              body: "Owners, property managers, accountants and caretakers see only what they need.",
            },
            {
              icon: ShieldCheck,
              title: "Every change accounted for",
              body: "Sensitive changes are written to an append-only audit log you can review.",
            },
          ].map((f) => (
            <div key={f.title}>
              <f.icon className="size-6 text-accent" aria-hidden />
              <h3 className="mt-3 font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
