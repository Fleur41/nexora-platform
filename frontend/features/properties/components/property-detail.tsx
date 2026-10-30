"use client";

import {
  ArrowLeft,
  BedDouble,
  Building2,
  DoorOpen,
  Layers,
  MapPin,
  Pencil,
  Percent,
  Plus,
  Trash2,
  UserCheck,
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { useOrganization } from "@/components/providers/organization-provider";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DocumentsPanel } from "@/features/documents/components/documents-panel";
import {
  useAssignProperty,
  useDeleteUnitType,
  useProperty,
  usePropertyAssignments,
  usePropertySummary,
  useSaveProperty,
  useUnassignProperty,
  useUnits,
  useUnitTypes,
} from "@/features/properties/api";
import { useMembers } from "@/features/team/api";
import { ApiError, errorMessage } from "@/lib/api/errors";
import { PROPERTY_TYPE, UNIT_CATEGORY, UNIT_STATUS } from "@/lib/labels";
import { ROLE_LABELS } from "@/lib/roles";
import { cn, formatMoney } from "@/lib/utils";
import type { Property, Unit, UnitStatus, UnitType } from "@/types/api";

import { PropertyFormDialog } from "./property-form-dialog";
import { UnitTypeDialog } from "./unit-type-dialog";
import { BulkUnitsDialog, UnitDetailDialog, UnitFormDialog } from "./unit-dialogs";

export function PropertyDetail() {
  const { id } = useParams<{ id: string }>();
  const { can } = useOrganization();
  const property = useProperty(id);
  const summary = usePropertySummary(id);
  const unitTypes = useUnitTypes(id);
  const [editing, setEditing] = React.useState(false);

  if (property.isPending) return <Skeleton className="h-96 w-full" />;
  if (property.isError) {
    return (
      <ErrorState
        message={
          property.error instanceof ApiError && property.error.status === 404
            ? "This property doesn't exist or you don't have access to it."
            : errorMessage(property.error)
        }
      />
    );
  }
  const p = property.data;
  const s = summary.data?.units;
  const types = unitTypes.data?.results ?? [];

  return (
    <>
      <Link href="/dashboard/properties" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Properties
      </Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
            {!p.is_active && <Badge variant="muted">Inactive</Badge>}
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>{p.reference}</span>
            <span>{PROPERTY_TYPE[p.property_type]}</span>
            {(p.town || p.county) && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden />
                {[p.address_line, p.town, p.county].filter(Boolean).join(", ")}
              </span>
            )}
          </p>
        </div>
        {can("properties.manage") && (
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil /> Edit property
          </Button>
        )}
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={DoorOpen} label="Units" value={s?.total ?? 0} loading={summary.isPending} />
        <Stat icon={UserCheck} label="Occupied" value={s?.occupied ?? 0} loading={summary.isPending} />
        <Stat icon={Building2} label="Available" value={s?.vacant ?? 0} loading={summary.isPending} />
        <Stat
          icon={Percent}
          label="Occupancy"
          value={s?.occupancy_rate === null || s === undefined ? "—" : `${s.occupancy_rate}%`}
          hint="Unavailable units are excluded"
          loading={summary.isPending}
        />
      </div>

      <Tabs defaultValue="units">
        <TabsList className="mb-4 h-auto flex-wrap">
          <TabsTrigger value="units">Units</TabsTrigger>
          <TabsTrigger value="types">Unit types</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="files">Photos &amp; files</TabsTrigger>
          {can("members.view") && <TabsTrigger value="staff">Staff access</TabsTrigger>}
        </TabsList>
        <TabsContent value="units">
          <UnitsOverview propertyId={p.id} unitTypes={types} unitTypesLoading={unitTypes.isPending} />
        </TabsContent>
        <TabsContent value="types">
          <UnitTypesTable propertyId={p.id} unitTypes={types} loading={unitTypes.isPending} />
        </TabsContent>
        <TabsContent value="details">
          <PropertyDetails property={p} />
        </TabsContent>
        <TabsContent value="files">
          <DocumentsPanel
            target="property"
            targetId={p.id}
            canManage={can("properties.manage")}
            categories={["photo", "other", "inspection"]}
            gallery
          />
        </TabsContent>
        {can("members.view") && (
          <TabsContent value="staff">
            <StaffAccess propertyId={p.id} />
          </TabsContent>
        )}
      </Tabs>
      <PropertyFormDialog open={editing} onOpenChange={setEditing} property={p} />
    </>
  );
}

function UnitsOverview({
  propertyId,
  unitTypes,
  unitTypesLoading,
}: {
  propertyId: string;
  unitTypes: UnitType[];
  unitTypesLoading: boolean;
}) {
  const { can } = useOrganization();
  const [status, setStatus] = React.useState<UnitStatus | "">("");
  const units = useUnits({ property: propertyId, status, page_size: 100 });
  const [adding, setAdding] = React.useState<"one" | "bulk" | null>(null);
  const [selected, setSelected] = React.useState<Unit | null>(null);
  const canManage = can("properties.manage");
  const noTypes = !unitTypesLoading && unitTypes.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <NativeSelect
          aria-label="Filter units by status"
          className="sm:w-56"
          value={status}
          onChange={(e) => setStatus(e.target.value as UnitStatus | "")}
        >
          <option value="">All statuses</option>
          {Object.entries(UNIT_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </NativeSelect>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="outline" disabled={noTypes} onClick={() => setAdding("bulk")}>
              <Layers /> Add several
            </Button>
            <Button disabled={noTypes} onClick={() => setAdding("one")}>
              <Plus /> Add unit
            </Button>
          </div>
        )}
      </div>
      {noTypes && canManage && (
        <Alert title="Add a unit type first">
          Unit types (e.g. bedsitter, 2 bedroom) set default rent and deposit for new units. Open
          the <strong>Unit types</strong> tab to add one.
        </Alert>
      )}

      {units.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : units.isError ? (
        <ErrorState message={errorMessage(units.error)} onRetry={() => units.refetch()} />
      ) : units.data.results.length === 0 ? (
        <EmptyState
          icon={DoorOpen}
          title={status ? "No units with this status" : "No units yet"}
          description={status ? "Choose another status filter." : "Add units individually or a numbered run at once."}
        />
      ) : (
        <>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10" aria-label="Units">
            {units.data.results.map((u) => (
              <li key={u.id}>
                <button
                  onClick={() => setSelected(u)}
                  className={cn(
                    "flex h-20 w-full flex-col items-start justify-between rounded-lg border p-2 text-left transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    UNIT_STATUS[u.status].tile,
                  )}
                >
                  {/* Named by its visible text (number, then tenant or status); the status is
                      spoken when a tenant's name is shown instead. */}
                  <span className="text-sm font-semibold">{u.number}</span>{" "}
                  <span className="w-full truncate text-[11px]">
                    {u.current_lease?.tenant_name ?? UNIT_STATUS[u.status].label}
                    {u.current_lease?.tenant_name && <span className="sr-only">, {UNIT_STATUS[u.status].label}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {units.data.count > units.data.results.length && (
            <p className="text-sm text-muted-foreground">
              Showing the first {units.data.results.length} of {units.data.count} units.{" "}
              <Link className="text-primary hover:underline" href={`/dashboard/units?property=${propertyId}`}>
                See all in the units list
              </Link>
            </p>
          )}
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
            {Object.entries(UNIT_STATUS).map(([k, v]) => (
              <li key={k} className="inline-flex items-center gap-1.5">
                <span className={cn("size-2 rounded-full", v.dot)} aria-hidden /> {v.label}
              </li>
            ))}
          </ul>
        </>
      )}
      <UnitFormDialog open={adding === "one"} onOpenChange={(o) => !o && setAdding(null)} propertyId={propertyId} unitTypes={unitTypes} />
      <BulkUnitsDialog open={adding === "bulk"} onOpenChange={(o) => !o && setAdding(null)} propertyId={propertyId} unitTypes={unitTypes} />
      <UnitDetailDialog unit={selected} unitTypes={unitTypes} onOpenChange={(o) => !o && setSelected(null)} />
    </div>
  );
}

function UnitTypesTable({
  propertyId,
  unitTypes,
  loading,
}: {
  propertyId: string;
  unitTypes: UnitType[];
  loading: boolean;
}) {
  const { can, current } = useOrganization();
  const remove = useDeleteUnitType();
  const [editing, setEditing] = React.useState<UnitType | "new" | null>(null);
  const [deleting, setDeleting] = React.useState<UnitType | null>(null);
  const canManage = can("properties.manage");
  const currency = current.organization.currency;

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => setEditing("new")}>
            <Plus /> Add unit type
          </Button>
        </div>
      )}
      {loading ? (
        <Skeleton className="h-32 w-full" />
      ) : unitTypes.length === 0 ? (
        <EmptyState
          icon={BedDouble}
          title="No unit types yet"
          description="Define the kinds of units in this property, such as bedsitters or two-bedroom apartments."
        />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden sm:table-cell">Category</TableHead>
                <TableHead>Default rent</TableHead>
                <TableHead className="hidden md:table-cell">Default deposit</TableHead>
                <TableHead>Units</TableHead>
                {canManage && <TableHead className="w-24"><span className="sr-only">Actions</span></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {unitTypes.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <p className="font-medium">{t.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.bedrooms} bed · {t.bathrooms} bath
                    </p>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{UNIT_CATEGORY[t.category]}</TableCell>
                  <TableCell>{formatMoney(t.default_rent, currency)}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    {Number(t.default_deposit) ? formatMoney(t.default_deposit, currency) : "None"}
                  </TableCell>
                  <TableCell>{t.unit_count}</TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}>
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive"
                        aria-label={`Delete ${t.name}`}
                        disabled={t.unit_count > 0}
                        title={t.unit_count > 0 ? "Units use this type" : undefined}
                        onClick={() => setDeleting(t)}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <UnitTypeDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        propertyId={propertyId}
        unitType={editing === "new" || editing === null ? undefined : editing}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete unit type?"
        description={deleting && `“${deleting.name}” will be removed. This is only possible while no units use it.`}
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success("Unit type deleted");
              setDeleting(null);
            },
            onError: (err) => toast.error(errorMessage(err)),
          })
        }
      />
    </div>
  );
}

function PropertyDetails({ property: p }: { property: Property }) {
  const { can } = useOrganization();
  const save = useSaveProperty();
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-2 font-semibold">About</h2>
          <p className="whitespace-pre-line text-sm text-muted-foreground">
            {p.description || "No description yet."}
          </p>
        </section>
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 font-semibold">Amenities</h2>
          {p.amenities.length ? (
            <ul className="flex flex-wrap gap-2">
              {p.amenities.map((a) => (
                <li key={a}>
                  <Badge variant="muted">{a}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">None listed.</p>
          )}
        </section>
      </div>
      <section className="space-y-4 rounded-xl border bg-card p-5 text-sm">
        <h2 className="font-semibold">Location</h2>
        <p className="text-muted-foreground">
          {[p.address_line, p.town, p.county, p.country].filter(Boolean).join(", ") || "Not set"}
        </p>
        {p.latitude && p.longitude && (
          <p className="text-muted-foreground">
            {p.latitude}, {p.longitude}
          </p>
        )}
        {p.map_url && (
          <a className="text-primary hover:underline" href={p.map_url} target="_blank" rel="noopener noreferrer">
            Open map
          </a>
        )}
        <div className="border-t pt-4">
          <h2 className="mb-1 font-semibold">Status</h2>
          <p className="mb-3 text-muted-foreground">
            {p.is_active ? "Active" : "Inactive: hidden from day-to-day lists."} Public listings
            arrive with the Nexora website; nothing is published yet.
          </p>
          {can("properties.manage") && (
            <Button
              variant="outline"
              size="sm"
              loading={save.isPending}
              onClick={() =>
                save.mutate(
                  { id: p.id, is_active: !p.is_active },
                  {
                    onSuccess: () => toast.success(p.is_active ? "Property deactivated" : "Property reactivated"),
                    onError: (err) => toast.error(errorMessage(err)),
                  },
                )
              }
            >
              {p.is_active ? "Deactivate" : "Reactivate"}
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}

function StaffAccess({ propertyId }: { propertyId: string }) {
  const { can } = useOrganization();
  const assignments = usePropertyAssignments({ property: propertyId });
  const members = useMembers({}, can("members.manage"));
  const assign = useAssignProperty();
  const unassign = useUnassignProperty();
  const [selected, setSelected] = React.useState("");

  const assignedIds = new Set(assignments.data?.map((a) => a.membership));
  const candidates =
    members.data?.results.filter(
      (m) => m.access_scope === "assigned" && m.role !== "owner" && !assignedIds.has(m.id),
    ) ?? [];

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-muted-foreground">
        Owners, accountants and anyone with whole-organization access already see this property.
        Staff limited to assigned properties (typically property managers and caretakers) need to
        be added here.
      </p>
      {can("members.manage") && (
        <div className="flex gap-2">
          <NativeSelect aria-label="Member to assign" value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">{candidates.length ? "Choose a team member…" : "No unassigned staff"}</option>
            {candidates.map((m) => (
              <option key={m.id} value={m.id}>
                {m.user.full_name} · {ROLE_LABELS[m.role]}
              </option>
            ))}
          </NativeSelect>
          <Button
            disabled={!selected}
            loading={assign.isPending}
            onClick={() =>
              assign.mutate(
                { property: propertyId, membership: selected },
                {
                  onSuccess: () => {
                    toast.success("Access granted");
                    setSelected("");
                  },
                  onError: (err) => toast.error(errorMessage(err)),
                },
              )
            }
          >
            Assign
          </Button>
        </div>
      )}
      {assignments.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : assignments.isError ? (
        <ErrorState message={errorMessage(assignments.error)} />
      ) : assignments.data.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          No staff are specifically assigned to this property.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {assignments.data.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{a.member_name}</p>
                <p className="truncate text-xs text-muted-foreground">{a.member_email}</p>
              </div>
              {can("members.manage") && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={unassign.isPending}
                  onClick={() =>
                    unassign.mutate(a.id, {
                      onSuccess: () => toast.success(`Removed ${a.member_name}`),
                      onError: (err) => toast.error(errorMessage(err)),
                    })
                  }
                >
                  <X /> Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
