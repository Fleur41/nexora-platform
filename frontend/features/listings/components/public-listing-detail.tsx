"use client";

import { ArrowLeft, BedDouble, Bath, CalendarCheck, CheckCircle2, Home, MapPin, Phone } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { Textarea } from "@/components/ui/textarea";
import { usePublicListing, useSubmitEnquiry } from "@/features/listings/api";
import { ApiError, errorMessage } from "@/lib/api/errors";
import { cn, formatDay, formatMoney } from "@/lib/utils";
import type { EnquiryKind, PublicListing, TimeOfDay } from "@/types/api";

import { bedroomsLabel } from "./public-listings";

export function PublicListingDetail() {
  const { id } = useParams<{ id: string }>();
  const listing = usePublicListing(id);

  if (listing.isPending) return <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6"><Skeleton className="h-[32rem] w-full" /></div>;
  if (listing.isError) {
    const gone = listing.error instanceof ApiError && listing.error.status === 404;
    return (
      <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
        <ErrorState message={gone ? "This home has been let or is no longer advertised." : errorMessage(listing.error)} />
        <p className="mt-4 text-center"><Link className="font-medium underline" href="/listings">See other homes</Link></p>
      </div>
    );
  }
  const l = listing.data;
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link href="/listings" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All homes
      </Link>
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Gallery listing={l} />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{l.title}</h1>
            <p className="mt-1 flex items-center gap-1 text-muted-foreground"><MapPin className="size-4" aria-hidden />{l.property_name} · {[l.town, l.county].filter(Boolean).join(", ")}</p>
          </div>
          <dl className="grid grid-cols-2 gap-4 rounded-xl border bg-card p-4 text-sm sm:grid-cols-4">
            <Fact label="Rent" value={`${formatMoney(l.rent, l.currency)} / month`} />
            <Fact label="Deposit" value={Number(l.deposit) ? formatMoney(l.deposit, l.currency) : "None"} />
            <Fact label="Size" value={bedroomsLabel(l.bedrooms, l.category)} icon={BedDouble} />
            <Fact label="Bathrooms" value={String(l.bathrooms)} icon={Bath} />
          </dl>
          <p className="inline-flex items-center gap-2 rounded-lg bg-accent/10 px-3 py-2 text-sm font-medium text-accent-strong">
            <CalendarCheck className="size-4" aria-hidden />
            {l.available_from ? `Available from ${formatDay(l.available_from)}` : "Available now"}
          </p>
          {l.description && <p className="whitespace-pre-line leading-relaxed">{l.description}</p>}
          {l.amenities.length > 0 && (
            <div>
              <h2 className="mb-2 font-semibold">Amenities</h2>
              <ul className="flex flex-wrap gap-2">
                {l.amenities.map((a) => <li key={a} className="rounded-full border px-3 py-1 text-sm">{a}</li>)}
              </ul>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            Let by <strong className="text-foreground">{l.landlord.name}</strong>. The exact address is shared when your viewing is booked.
          </p>
        </div>
        <div className="lg:sticky lg:top-24 lg:self-start">
          <EnquiryForm listing={l} />
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value, icon: Icon }: { label: string; value: string; icon?: typeof Home }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 flex items-center gap-1 font-medium">{Icon && <Icon className="size-4 text-muted-foreground" aria-hidden />}{value}</dd>
    </div>
  );
}

function Gallery({ listing: l }: { listing: PublicListing }) {
  const [index, setIndex] = React.useState(0);
  if (l.photos.length === 0) {
    return <div className="flex aspect-[16/9] items-center justify-center rounded-xl bg-muted text-muted-foreground"><Home className="size-10" aria-hidden /></div>;
  }
  const photo = l.photos[Math.min(index, l.photos.length - 1)]!;
  return (
    <div className="space-y-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- served by the API, not optimisable */}
      <img src={photo.url} alt={`${l.title}, photo ${index + 1} of ${l.photos.length}`} className="aspect-[16/9] w-full rounded-xl object-cover" />
      {l.photos.length > 1 && (
        <div className="flex gap-2 overflow-x-auto">
          {l.photos.map((p, i) => (
            <button key={p.id} type="button" onClick={() => setIndex(i)} aria-label={`Show photo ${i + 1}`} aria-current={i === index}
              className={cn("shrink-0 overflow-hidden rounded-lg border-2", i === index ? "border-primary" : "border-transparent opacity-80 hover:opacity-100")}>
              {/* eslint-disable-next-line @next/next/no-img-element -- served by the API, not optimisable */}
              <img src={p.url} alt="" className="h-16 w-24 object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const TIMES: Record<TimeOfDay, string> = { any: "Any time", morning: "Morning", afternoon: "Afternoon", evening: "Evening" };

function EnquiryForm({ listing: l }: { listing: PublicListing }) {
  const submit = useSubmitEnquiry(l.id);
  const [kind, setKind] = React.useState<EnquiryKind>("viewing");
  // Read the clock once, when the form first renders.
  const [today] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [form, setForm] = React.useState(() => ({
    name: "",
    phone: "",
    email: "",
    message: "",
    preferred_date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
    preferred_time: "any" as TimeOfDay,
    website: "",
  }));
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  if (submit.isSuccess) {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6 text-center">
          <CheckCircle2 className="mx-auto size-10 text-accent-strong" aria-hidden />
          <p className="text-lg font-semibold">{kind === "viewing" ? "Viewing request sent" : "Message sent"}</p>
          <p className="text-sm text-muted-foreground">
            {l.landlord.name} will call you on {form.phone} to {kind === "viewing" ? "confirm a time" : "answer your question"}.
            {submit.data.reference && <> Your reference is <strong className="text-foreground">{submit.data.reference}</strong>.</>}
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Interested?</CardTitle>
        <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="What would you like to do?">
          {(["viewing", "enquiry"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)}
              className={cn("rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground", kind === k && "bg-background text-foreground shadow-sm")}>
              {k === "viewing" ? "Book a viewing" : "Ask a question"}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate({
              kind,
              name: form.name,
              phone: form.phone,
              email: form.email,
              message: form.message,
              website: form.website,
              ...(kind === "viewing" ? { preferred_date: form.preferred_date, preferred_time: form.preferred_time } : {}),
            });
          }}
        >
          {submit.isError && <Alert variant="error" title={errorMessage(submit.error)} />}
          <FormField id="e-name" label="Your name">
            <Input required autoComplete="name" value={form.name} onChange={(e) => set("name", e.target.value)} />
          </FormField>
          <FormField id="e-phone" label="Phone">
            <Input required type="tel" autoComplete="tel" placeholder="07XX XXX XXX" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </FormField>
          <FormField id="e-email" label="Email (optional)" hint="For a confirmation of your request.">
            <Input type="email" autoComplete="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </FormField>
          {kind === "viewing" && (
            <div className="grid grid-cols-2 gap-3">
              <FormField id="e-date" label="Preferred day">
                <Input required type="date" min={today} value={form.preferred_date} onChange={(e) => set("preferred_date", e.target.value)} />
              </FormField>
              <FormField id="e-time" label="Time">
                <NativeSelect value={form.preferred_time} onChange={(e) => set("preferred_time", e.target.value as TimeOfDay)}>
                  {Object.entries(TIMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </NativeSelect>
              </FormField>
            </div>
          )}
          <FormField id="e-msg" label={kind === "viewing" ? "Anything else? (optional)" : "Your question"}>
            <Textarea required={kind === "enquiry"} rows={3} value={form.message} onChange={(e) => set("message", e.target.value)} />
          </FormField>
          {/* Spam trap: hidden from people (and screen readers); bots fill it in. */}
          <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
            <label>Website<input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => set("website", e.target.value)} /></label>
          </div>
          <Button type="submit" className="w-full" size="lg" loading={submit.isPending}>
            {kind === "viewing" ? "Request a viewing" : "Send question"}
          </Button>
          {l.landlord.phone && (
            <p className="flex items-center justify-center gap-1 text-sm text-muted-foreground">
              <Phone className="size-4" aria-hidden /> Or call <a className="font-medium text-foreground underline" href={`tel:${l.landlord.phone}`}>{l.landlord.phone}</a>
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
