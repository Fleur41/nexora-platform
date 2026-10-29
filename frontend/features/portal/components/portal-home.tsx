"use client";

import { CalendarClock, ChevronRight, FileText, Receipt, Smartphone, Wrench } from "lucide-react";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { usePortalMoveOuts, usePortalSummary } from "@/features/portal/api";
import { useTenancy } from "@/features/portal/tenancy";
import { errorMessage } from "@/lib/api/errors";
import { MOVE_OUT_STATUS } from "@/lib/labels";
import { formatDay, formatMoney, plural, todayIn } from "@/lib/utils";

export function PortalHome() {
  const { tenantId, currency, tenancy, timeZone } = useTenancy();
  const summary = usePortalSummary(tenantId);
  const moveOuts = usePortalMoveOuts(tenantId);

  if (summary.isPending) return <Skeleton className="h-96 w-full" />;
  if (summary.isError) return <ErrorState message={errorMessage(summary.error)} onRetry={() => summary.refetch()} />;
  const s = summary.data;
  const owes = Number(s.balance) > 0;
  const overdue = Number(s.overdue) > 0;
  const openNotice = moveOuts.data?.find((n) => n.status !== "completed" && n.status !== "withdrawn");
  const credit = s.leases.reduce((sum, l) => sum + Number(l.credit), 0);

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold tracking-tight">Hi {s.full_name.split(" ")[0]}</h1>

      <Card className={overdue ? "border-destructive/40" : undefined}>
        <CardContent className="space-y-4 pt-6">
          <div>
            <p className="text-sm text-muted-foreground">{owes ? "You owe" : "Your balance"}</p>
            <p className={`text-3xl font-semibold tracking-tight ${overdue ? "text-destructive" : ""}`} data-testid="portal-balance">
              {formatMoney(owes ? s.balance : 0, currency)}
            </p>
            {overdue && <p className="text-sm font-medium text-destructive">{formatMoney(s.overdue, currency)} is overdue</p>}
            {!owes && <p className="text-sm text-muted-foreground">You&apos;re all paid up. Thank you!</p>}
            {credit > 0 && <p className="text-sm text-accent-strong">{formatMoney(credit, currency)} in credit, used on your next bill.</p>}
          </div>
          {s.next_due && (
            <Link href={`/portal/invoices/${s.next_due.id}`} className="flex items-center gap-3 rounded-lg bg-muted/60 p-3 text-sm hover:bg-muted">
              <CalendarClock className="size-5 text-muted-foreground" aria-hidden />
              <span className="flex-1">
                {s.next_due.due_date < todayIn(timeZone) ? "Overdue bill" : "Next bill"} <strong>{s.next_due.number}</strong>: {formatMoney(s.next_due.amount_due, currency)} due {formatDay(s.next_due.due_date)}
              </span>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
            </Link>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button asChild size="lg"><Link href="/portal/pay"><Smartphone /> Pay rent</Link></Button>
            <Button asChild size="lg" variant="outline"><Link href="/portal/maintenance?new=1"><Wrench /> Report a repair</Link></Button>
          </div>
        </CardContent>
      </Card>

      {openNotice && (
        <Alert title={`Move-out notice: ${MOVE_OUT_STATUS[openNotice.status].label.toLowerCase()}`}>
          You plan to move out on {formatDay(openNotice.intended_date)}.
          {openNotice.inspection_date && ` The move-out inspection is on ${formatDay(openNotice.inspection_date)}.`}{" "}
          <Link className="font-medium underline" href="/portal/move-out">Details</Link>
        </Alert>
      )}

      <div className="grid grid-cols-3 gap-2 text-center text-xs font-medium">
        <QuickLink href="/portal/invoices" icon={FileText} label="Bills" />
        <QuickLink href="/portal/invoices?tab=receipts" icon={Receipt} label="Receipts" />
        <QuickLink href="/portal/maintenance" icon={Wrench} label={s.open_maintenance ? `${plural(s.open_maintenance, "open repair")}` : "Repairs"} />
      </div>

      {s.leases.map((l) => (
        <Card key={l.id}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              {l.property_name} · Unit {l.unit_number}
              {l.status === "ended" && <Badge variant="muted">Ended</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {l.monthly_rent && <Item label="Rent" value={`${formatMoney(l.monthly_rent, currency)} / month`} />}
              {l.status === "active" && <Item label="Due" value={`Day ${l.rent_due_day} of each month`} />}
              <Item label="Deposit held" value={formatMoney(l.deposit_held, currency)} />
              <Item label="Lease" value={l.reference} />
              <Item label="Since" value={formatDay(l.start_date)} />
              {(l.ended_on ?? l.end_date) && <Item label={l.ended_on ? "Ended" : "Ends"} value={formatDay(l.ended_on ?? l.end_date)} />}
            </dl>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Recent payments</CardTitle></CardHeader>
        <CardContent>
          {s.recent_payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {s.recent_payments.map((p) => (
                <li key={p.id}>
                  <Link href={`/portal/payments/${p.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:underline">
                    <span>{formatDay(p.received_on)}<span className="block text-xs text-muted-foreground">{p.receipt_number}</span></span>
                    <span className="font-medium">{formatMoney(p.amount, currency)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        Questions about your account? Contact {tenancy.organization.name}
        {tenancy.organization.phone && <> on <a className="underline" href={`tel:${tenancy.organization.phone}`}>{tenancy.organization.phone}</a></>}
        {tenancy.organization.email && <> or <a className="underline" href={`mailto:${tenancy.organization.email}`}>{tenancy.organization.email}</a></>}.
      </p>
    </div>
  );
}

function QuickLink({ href, icon: Icon, label }: { href: string; icon: typeof FileText; label: string }) {
  return (
    <Link href={href} className="flex flex-col items-center gap-1.5 rounded-xl border bg-card p-3 hover:bg-muted">
      <Icon className="size-5 text-accent-strong" aria-hidden />
      {label}
    </Link>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
