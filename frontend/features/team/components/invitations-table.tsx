"use client";

import { MailPlus, RotateCw, XCircle } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { useOrganization } from "@/components/providers/organization-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { NativeSelect } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useInvitationAction, useInvitations } from "@/features/team/api";
import { errorMessage } from "@/lib/api/errors";
import { ROLE_LABELS } from "@/lib/roles";
import { formatDate } from "@/lib/utils";
import type { Invitation } from "@/types/api";

function statusBadge(inv: Invitation) {
  if (inv.status === "pending" && inv.is_expired) return <Badge variant="warning">Expired</Badge>;
  if (inv.status === "pending") return <Badge variant="accent">Pending</Badge>;
  if (inv.status === "accepted") return <Badge variant="default">Accepted</Badge>;
  return <Badge variant="muted">Revoked</Badge>;
}

export function InvitationsTable() {
  const { current, can } = useOrganization();
  const [status, setStatus] = React.useState("pending");
  const [page, setPage] = React.useState(1);
  const invitations = useInvitations({ status, page });
  const action = useInvitationAction();
  const [revoking, setRevoking] = React.useState<Invitation | null>(null);
  const canManage = can("members.manage");

  const run = (inv: Invitation, kind: "resend" | "revoke") =>
    action.mutate(
      { id: inv.id, action: kind },
      {
        onSuccess: () => {
          toast.success(kind === "resend" ? `Invitation resent to ${inv.email}` : "Invitation revoked");
          setRevoking(null);
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );

  return (
    <div className="space-y-4">
      <NativeSelect
        aria-label="Filter invitations by status"
        className="sm:w-56"
        value={status}
        onChange={(e) => {
          setStatus(e.target.value);
          setPage(1);
        }}
      >
        <option value="pending">Pending</option>
        <option value="accepted">Accepted</option>
        <option value="revoked">Revoked</option>
        <option value="">All</option>
      </NativeSelect>

      {invitations.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : invitations.isError ? (
        <ErrorState message={errorMessage(invitations.error)} onRetry={() => invitations.refetch()} />
      ) : invitations.data.results.length === 0 ? (
        <EmptyState
          icon={MailPlus}
          title="No invitations here"
          description={
            status === "pending"
              ? "Invitations you send will appear here until they are accepted."
              : "Nothing matches this filter."
          }
        />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Expires</TableHead>
                {canManage && (
                  <TableHead className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.data.results.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>
                    <p className="font-medium">{inv.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Invited by {inv.invited_by_name || "—"}
                    </p>
                  </TableCell>
                  <TableCell>{ROLE_LABELS[inv.role]}</TableCell>
                  <TableCell>{statusBadge(inv)}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {formatDate(inv.expires_at, current.organization.timezone)}
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      {inv.status === "pending" &&
                        (inv.role !== "owner" || current.role === "owner") && (
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={action.isPending}
                              onClick={() => run(inv, "resend")}
                            >
                              <RotateCw /> Resend
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              onClick={() => setRevoking(inv)}
                            >
                              <XCircle /> Revoke
                            </Button>
                          </div>
                        )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {invitations.data && (
        <Pagination page={page} pageSize={25} count={invitations.data.count} onPageChange={setPage} />
      )}
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Revoke invitation?"
        description={revoking && `The link sent to ${revoking.email} will stop working.`}
        confirmLabel="Revoke"
        destructive
        loading={action.isPending}
        onConfirm={() => revoking && run(revoking, "revoke")}
      />
    </div>
  );
}
