"use client";

import { ArrowLeft, CalendarCheck, Mail, Phone, PhoneCall, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { useOrganization } from "@/components/providers/organization-provider";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { Textarea } from "@/components/ui/textarea";
import { useEnquiry, useUpdateEnquiry } from "@/features/listings/api";
import { ApiError, errorMessage } from "@/lib/api/errors";
import { ENQUIRY_OUTCOME, ENQUIRY_STATUS, TIME_OF_DAY } from "@/lib/labels";
import { formatDateTime, formatDay } from "@/lib/utils";
import type { Enquiry, EnquiryOutcome } from "@/types/api";

export function EnquiryDetail() {
  const { id } = useParams<{ id: string }>();
  const { can, current } = useOrganization();
  const enquiry = useEnquiry(id);
  if (enquiry.isPending) return <Skeleton className="h-96 w-full" />;
  if (enquiry.isError) {
    return <ErrorState message={enquiry.error instanceof ApiError && enquiry.error.status === 404 ? "This enquiry doesn't exist or isn't for one of your properties." : errorMessage(enquiry.error)} />;
  }
  const e = enquiry.data;
  const tz = current.organization.timezone;
  const manage = can("listings.manage") && e.status !== "closed";
  return (
    <>
      <Link href="/dashboard/listings?tab=enquiries" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Enquiries
      </Link>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{e.name}</h1>
        <Badge variant={ENQUIRY_STATUS[e.status].variant}>{ENQUIRY_STATUS[e.status].label}</Badge>
        <span className="text-sm text-muted-foreground">{e.reference} · {e.kind === "viewing" ? "Viewing request" : "Question"} · {formatDateTime(e.created_at, tz)}</span>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Request</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>About <strong>{e.listing_title}</strong> · {e.property_name} unit {e.unit_number}</p>
              {e.kind === "viewing" && e.preferred_date && (
                <p>Would like to view on <strong>{formatDay(e.preferred_date)}</strong> ({TIME_OF_DAY[e.preferred_time].toLowerCase()}).</p>
              )}
              {e.message && <p className="whitespace-pre-line rounded-lg bg-muted/60 p-3">{e.message}</p>}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button asChild size="sm" variant="outline"><a href={`tel:${e.phone}`}><Phone /> {e.phone}</a></Button>
                {e.email && <Button asChild size="sm" variant="outline"><a href={`mailto:${e.email}`}><Mail /> {e.email}</a></Button>}
              </div>
            </CardContent>
          </Card>
          <NotesCard enquiry={e} canEdit={can("listings.manage")} />
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Progress</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {e.viewing_at && <p className="flex items-center gap-2"><CalendarCheck className="size-4 text-accent-strong" /> Viewing {formatDateTime(e.viewing_at, tz)}</p>}
              {e.status === "closed" && <p>Closed: {e.outcome ? ENQUIRY_OUTCOME[e.outcome as Exclude<EnquiryOutcome, "">] : "—"}</p>}
              {e.handled_by_name && <p className="text-muted-foreground">Handled by {e.handled_by_name}</p>}
              {manage && <Actions enquiry={e} />}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function Actions({ enquiry: e }: { enquiry: Enquiry }) {
  const update = useUpdateEnquiry();
  const [viewing, setViewing] = React.useState("");
  const [outcome, setOutcome] = React.useState<EnquiryOutcome>("");
  const run = (body: Parameters<typeof update.mutate>[0], done: string) =>
    update.mutate(body, { onSuccess: () => toast.success(done), onError: (err) => toast.error(errorMessage(err)) });
  return (
    <div className="space-y-4 border-t pt-3">
      {e.status === "new" && (
        <Button size="sm" variant="outline" className="w-full" loading={update.isPending} onClick={() => run({ id: e.id, status: "contacted" }, "Marked as contacted")}>
          <PhoneCall /> I&apos;ve contacted them
        </Button>
      )}
      <div className="space-y-2">
        <FormField id="enq-viewing" label={e.viewing_at ? "Move the viewing" : "Book a viewing"} hint={e.email ? "They're emailed the time." : "Call them to confirm the time."}>
          <Input type="datetime-local" value={viewing} onChange={(ev) => setViewing(ev.target.value)} />
        </FormField>
        <Button size="sm" className="w-full" disabled={!viewing} loading={update.isPending}
          onClick={() => run({ id: e.id, viewing_at: new Date(viewing).toISOString() }, "Viewing booked")}>
          <CalendarCheck /> Save viewing
        </Button>
      </div>
      <div className="space-y-2">
        <FormField id="enq-outcome" label="Close with outcome">
          <NativeSelect value={outcome} onChange={(ev) => setOutcome(ev.target.value as EnquiryOutcome)}>
            <option value="">Choose…</option>
            {Object.entries(ENQUIRY_OUTCOME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </NativeSelect>
        </FormField>
        <Button size="sm" variant="outline" className="w-full" disabled={!outcome} loading={update.isPending}
          onClick={() => run({ id: e.id, status: "closed", outcome }, "Enquiry closed")}>
          <XCircle /> Close enquiry
        </Button>
        {outcome === "let" && <Alert title="Next: create the lease">Register the tenant and create their lease; the listing comes down by itself once the unit is let.</Alert>}
      </div>
    </div>
  );
}

function NotesCard({ enquiry: e, canEdit }: { enquiry: Enquiry; canEdit: boolean }) {
  const update = useUpdateEnquiry();
  const [notes, setNotes] = React.useState(e.staff_notes);
  return (
    <Card>
      <CardHeader><CardTitle>Internal notes</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {canEdit ? (
          <>
            <Textarea rows={4} aria-label="Internal notes" placeholder="Never shown to the enquirer." value={notes} onChange={(ev) => setNotes(ev.target.value)} />
            <Button size="sm" variant="outline" disabled={notes === e.staff_notes} loading={update.isPending}
              onClick={() => update.mutate({ id: e.id, staff_notes: notes }, { onSuccess: () => toast.success("Notes saved") })}>
              Save notes
            </Button>
          </>
        ) : (
          <p className="whitespace-pre-line text-sm text-muted-foreground">{e.staff_notes || "No notes."}</p>
        )}
      </CardContent>
    </Card>
  );
}
