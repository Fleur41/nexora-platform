import { Badge } from "@/components/ui/badge";
import { todayIn } from "@/lib/utils";
import type { Invoice } from "@/types/api";

/** Status as a person reads it: void, settled, overdue or open. */
export function InvoiceStatusBadge({ invoice, timeZone }: { invoice: Invoice; timeZone: string }) {
  if (invoice.status === "void") return <Badge variant="muted">Void</Badge>;
  if (Number(invoice.amount_due) <= 0) return <Badge variant="accent">Settled</Badge>;
  if (invoice.due_date < todayIn(timeZone)) return <Badge variant="destructive">Overdue</Badge>;
  return <Badge variant="warning">Open</Badge>;
}
