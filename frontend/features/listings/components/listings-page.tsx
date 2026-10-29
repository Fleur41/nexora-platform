"use client";

import { Check, Copy, ExternalLink, Home, Inbox, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { useOrganization } from "@/components/providers/organization-provider";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useDocumentBlob } from "@/features/documents/api";
import { useEnquiries, useListings, usePhotoOptions, useSaveListing } from "@/features/listings/api";
import { usePropertyOptions, useUnits } from "@/features/properties/api";
import { errorMessage } from "@/lib/api/errors";
import { ENQUIRY_STATUS, TIME_OF_DAY } from "@/lib/labels";
import { cn, formatDateTime, formatDay, formatMoney } from "@/lib/utils";
import type { EnquiryStatus, Listing } from "@/types/api";

export function ListingsPage() {
  const { can } = useOrganization();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = params.get("tab") === "enquiries" ? "enquiries" : "listings";
  if (!can("listings.view")) return <Alert variant="error" title="You don't have permission to view listings." />;
  return (
    <>
      <PageHeader title="Listings" description="Advertise vacant units on the public website and follow up enquiries and viewing requests." />
      <Tabs value={tab} onValueChange={(v) => router.replace(v === "listings" ? pathname : `${pathname}?tab=${v}`, { scroll: false })}>
        <TabsList className="mb-4">
          <TabsTrigger value="listings">Listings</TabsTrigger>
          <TabsTrigger value="enquiries">Enquiries &amp; viewings</TabsTrigger>
        </TabsList>
        <TabsContent value="listings"><ListingsTab /></TabsContent>
        <TabsContent value="enquiries"><EnquiriesTab /></TabsContent>
      </Tabs>
    </>
  );
}

function ListingsTab() {
  const { can, current } = useOrganization();
  const [page, setPage] = React.useState(1);
  const [editing, setEditing] = React.useState<Listing | "new" | null>(null);
  const listings = useListings({ page });
  const manage = can("listings.manage");
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          A listing shows on <Link className="underline" href="/listings" target="_blank">the public website</Link> while it is published and its unit is free to let.
        </p>
        {manage && <Button onClick={() => setEditing("new")}><Plus /> New listing</Button>}
      </div>
      {listings.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : listings.isError ? (
        <ErrorState message={errorMessage(listings.error)} onRetry={() => listings.refetch()} />
      ) : listings.data.results.length === 0 ? (
        <EmptyState icon={Home} title="No listings yet" description="Publish a vacant unit to receive enquiries and viewing requests from the website." />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Listing</TableHead>
                <TableHead className="hidden md:table-cell">Unit</TableHead>
                <TableHead className="text-right">Rent</TableHead>
                <TableHead>On the website</TableHead>
                <TableHead className="hidden lg:table-cell">Open enquiries</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listings.data.results.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    {manage ? (
                      <button type="button" className="text-left font-medium hover:underline" onClick={() => setEditing(l)}>{l.title}</button>
                    ) : (
                      <span className="font-medium">{l.title}</span>
                    )}
                    <p className="text-xs text-muted-foreground">{l.photos.length} photo{l.photos.length === 1 ? "" : "s"}{l.available_from && ` · from ${formatDay(l.available_from)}`}</p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{l.property_name} · {l.unit_number}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(l.rent, current.organization.currency)}</TableCell>
                  <TableCell>
                    {l.is_public ? (
                      <span className="inline-flex items-center gap-2">
                        <Badge variant="accent">Live</Badge>
                        <CopyLink url={l.public_url} />
                        <a href={l.public_url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground"><ExternalLink className="size-4" /><span className="sr-only">Open {l.title}</span></a>
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">{l.hidden_reason}</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">{l.open_enquiries || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {listings.data && <Pagination page={page} pageSize={25} count={listings.data.count} onPageChange={setPage} />}
      {editing && <ListingDialog listing={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button type="button" className="text-muted-foreground hover:text-foreground"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Couldn't copy the link.");
        }
      }}>
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      <span className="sr-only">Copy the public link</span>
    </button>
  );
}

function ListingDialog({ listing, onClose }: { listing: Listing | null; onClose: () => void }) {
  const save = useSaveListing();
  const properties = usePropertyOptions(!listing);
  const [property, setProperty] = React.useState("");
  const units = useUnits({ property, page_size: 100 }, Boolean(property) && !listing);
  const [form, setForm] = React.useState({
    unit: listing?.unit ?? "",
    title: listing?.title ?? "",
    description: listing?.description ?? "",
    is_published: listing?.is_published ?? true,
    available_from: listing?.available_from ?? "",
    contact_phone: listing?.contact_phone ?? "",
    photo_ids: listing?.photos.map((p) => p.id) ?? [],
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const options = usePhotoOptions(form.unit);
  const togglePhoto = (id: string) =>
    set("photo_ids", form.photo_ids.includes(id) ? form.photo_ids.filter((p) => p !== id) : [...form.photo_ids, id].slice(0, 12));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{listing ? "Edit listing" : "New listing"}</DialogTitle>
          <DialogDescription>Only the area (town and county) is shown publicly, never the street address. Only the photos you tick are published.</DialogDescription>
        </DialogHeader>
        {save.isError && <Alert variant="error" title={errorMessage(save.error)} />}
        {!listing && (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="ls-prop" label="Property">
              <NativeSelect value={property} onChange={(e) => { setProperty(e.target.value); set("unit", ""); set("photo_ids", []); }}>
                <option value="">Choose…</option>
                {properties.data?.results.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </NativeSelect>
            </FormField>
            <FormField id="ls-unit" label="Unit">
              <NativeSelect value={form.unit} disabled={!property} onChange={(e) => {
                const unit = units.data?.results.find((u) => u.id === e.target.value);
                set("unit", e.target.value);
                set("photo_ids", []);
                const prop = properties.data?.results.find((p) => p.id === property);
                if (unit && !form.title) set("title", `${unit.unit_type_name ?? "Unit"} in ${prop?.town || prop?.name || ""}`.trim());
              }}>
                <option value="">Choose…</option>
                {units.data?.results.map((u) => <option key={u.id} value={u.id}>{u.number} · {u.status.replaceAll("_", " ")}</option>)}
              </NativeSelect>
            </FormField>
          </div>
        )}
        <FormField id="ls-title" label="Title" hint="What people see in search results, e.g. “Bright 2-bedroom near Sarit”.">
          <Input maxLength={160} value={form.title} onChange={(e) => set("title", e.target.value)} />
        </FormField>
        <FormField id="ls-desc" label="Description">
          <Textarea rows={4} value={form.description} onChange={(e) => set("description", e.target.value)} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="ls-from" label="Available from (optional)" hint="Empty means now. If the tenant is on notice, it's the day after they leave.">
            <Input type="date" value={form.available_from} onChange={(e) => set("available_from", e.target.value)} />
          </FormField>
          <FormField id="ls-phone" label="Contact phone (optional)" hint="Your organization's phone if empty.">
            <Input type="tel" value={form.contact_phone} onChange={(e) => set("contact_phone", e.target.value)} />
          </FormField>
        </div>
        {form.unit && (
          <div>
            <p className="mb-2 text-sm font-medium">Photos <span className="font-normal text-muted-foreground">({form.photo_ids.length} chosen; the first is the cover)</span></p>
            {options.data?.length === 0 ? (
              <p className="text-sm text-muted-foreground">No photos yet. Upload photos on the unit or property page (category “Photo”).</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {options.data?.map((p) => {
                  const n = form.photo_ids.indexOf(p.id);
                  return (
                    <button key={p.id} type="button" onClick={() => togglePhoto(p.id)} aria-pressed={n >= 0} aria-label={`${n >= 0 ? "Remove" : "Use"} photo ${p.title}`}
                      className={cn("relative overflow-hidden rounded-lg border-2", n >= 0 ? "border-primary" : "border-transparent opacity-70 hover:opacity-100")}>
                      <PhotoThumb id={p.id} title={p.title} />
                      {n >= 0 && <span className="absolute left-1 top-1 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">{n + 1}</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--accent)]" checked={form.is_published} onChange={(e) => set("is_published", e.target.checked)} />
          <span><span className="font-medium">Published</span><span className="block text-muted-foreground">Shown on the website while the unit is free to let; hidden automatically once it&apos;s let.</span></span>
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!form.unit || !form.title.trim()} loading={save.isPending}
            onClick={() => save.mutate(
              { id: listing?.id, ...form, available_from: form.available_from || null, ...(listing ? { unit: undefined } : {}) },
              { onSuccess: (l) => { toast.success(l.is_public ? "Listing is live" : "Listing saved"); onClose(); } },
            )}>
            Save listing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PhotoThumb({ id, title }: { id: string; title: string }) {
  const blob = useDocumentBlob(id);
  const url = React.useMemo(() => (blob.data ? URL.createObjectURL(blob.data) : null), [blob.data]);
  React.useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  if (!url) return <Skeleton className="aspect-[4/3] w-full rounded-none" />;
  // eslint-disable-next-line @next/next/no-img-element -- private blob URL, not optimisable
  return <img src={url} alt={title} className="aspect-[4/3] w-full object-cover" />;
}

function EnquiriesTab() {
  const { current } = useOrganization();
  const [view, setView] = React.useState<"open" | EnquiryStatus | "all">("open");
  const [page, setPage] = React.useState(1);
  const enquiries = useEnquiries({ page, open: view === "open" || undefined, status: view !== "open" && view !== "all" ? view : "" });
  return (
    <>
      <NativeSelect aria-label="Show" className="mb-4 md:w-48" value={view} onChange={(e) => { setView(e.target.value as typeof view); setPage(1); }}>
        <option value="open">Open</option>
        {Object.entries(ENQUIRY_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        <option value="all">All</option>
      </NativeSelect>
      {enquiries.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : enquiries.isError ? (
        <ErrorState message={errorMessage(enquiries.error)} onRetry={() => enquiries.refetch()} />
      ) : enquiries.data.results.length === 0 ? (
        <EmptyState icon={Inbox} title="No enquiries here" description="Messages and viewing requests from the website arrive here, and you're notified." />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>From</TableHead>
                <TableHead className="hidden md:table-cell">About</TableHead>
                <TableHead>Request</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">Received</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {enquiries.data.results.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <Link href={`/dashboard/listings/enquiries/${e.id}`} className="font-medium hover:underline">{e.name}</Link>
                    <p className="text-xs text-muted-foreground">{e.reference} · {e.phone}</p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{e.property_name} · {e.unit_number}</TableCell>
                  <TableCell>
                    {e.kind === "viewing" ? "Viewing" : "Question"}
                    {e.kind === "viewing" && e.preferred_date && <p className="text-xs text-muted-foreground">{formatDay(e.preferred_date)} · {TIME_OF_DAY[e.preferred_time]}</p>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={ENQUIRY_STATUS[e.status].variant}>{ENQUIRY_STATUS[e.status].label}</Badge>
                    {e.viewing_at && e.status === "viewing_booked" && <p className="text-xs text-muted-foreground">{formatDateTime(e.viewing_at, current.organization.timezone)}</p>}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{formatDateTime(e.created_at, current.organization.timezone)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {enquiries.data && <Pagination page={page} pageSize={25} count={enquiries.data.count} onPageChange={setPage} />}
    </>
  );
}
