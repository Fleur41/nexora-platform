"use client";

import { MoreHorizontal, Search, ShieldCheck, UserMinus, Users } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { useOrganization } from "@/components/providers/organization-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input, NativeSelect } from "@/components/ui/input";
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
import { useMe } from "@/features/auth/api";
import { useMembers, useRemoveMember } from "@/features/team/api";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { errorMessage } from "@/lib/api/errors";
import { ASSIGNABLE_ROLES, ROLE_LABELS } from "@/lib/roles";
import { formatDate, initials } from "@/lib/utils";
import type { Membership, Role } from "@/types/api";

import { EditMemberDialog } from "./edit-member-dialog";

const PAGE_SIZE = 25;

export function MembersTable() {
  const { current, can } = useOrganization();
  const me = useMe();
  const [search, setSearch] = React.useState("");
  const [role, setRole] = React.useState<Role | "">("");
  const [page, setPage] = React.useState(1);
  const debounced = useDebouncedValue(search, 300);
  const members = useMembers({ search: debounced, role, page });
  const remove = useRemoveMember();
  const [editing, setEditing] = React.useState<Membership | null>(null);
  const [removing, setRemoving] = React.useState<Membership | null>(null);

  const canManage = (m: Membership) =>
    can("members.manage") &&
    m.user.id !== me.data?.id &&
    (m.role !== "owner" || current.role === "owner");

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            aria-label="Search members"
            placeholder="Search by name or email"
            className="pl-9"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <NativeSelect
          aria-label="Filter by role"
          className="sm:w-56"
          value={role}
          onChange={(e) => {
            setRole(e.target.value as Role | "");
            setPage(1);
          }}
        >
          <option value="">All roles</option>
          {ASSIGNABLE_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </NativeSelect>
      </div>

      {members.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : members.isError ? (
        <ErrorState message={errorMessage(members.error)} onRetry={() => members.refetch()} />
      ) : members.data.results.length === 0 ? (
        <EmptyState
          icon={Users}
          title={debounced || role ? "No matching members" : "No team members yet"}
          description={
            debounced || role
              ? "Try a different search or role filter."
              : "Invite your property managers, accountants and caretakers."
          }
        />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden md:table-cell">Joined</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.data.results.map((m) => {
                const customized = m.extra_permissions.length + m.revoked_permissions.length > 0;
                return (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                          {initials(m.user.full_name)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {m.user.full_name}
                            {m.user.id === me.data?.id && (
                              <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                            )}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">{m.user.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={m.role === "owner" ? "default" : "muted"}>
                          {ROLE_LABELS[m.role]}
                        </Badge>
                        {customized && <Badge variant="outline">Custom</Badge>}
                        {m.status === "suspended" && <Badge variant="warning">Suspended</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {formatDate(m.joined_at, current.organization.timezone)}
                    </TableCell>
                    <TableCell>
                      {canManage(m) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={`Actions for ${m.user.full_name}`}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setEditing(m)}>
                              <ShieldCheck /> Edit access
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => setRemoving(m)}
                            >
                              <UserMinus /> Remove from organization
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {members.data && (
        <Pagination page={page} pageSize={PAGE_SIZE} count={members.data.count} onPageChange={setPage} />
      )}

      <EditMemberDialog member={editing} onOpenChange={(open) => !open && setEditing(null)} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove member?"
        description={
          removing &&
          `${removing.user.full_name} will immediately lose access to ${current.organization.name}. Their past activity stays in the audit log.`
        }
        confirmLabel="Remove member"
        destructive
        loading={remove.isPending}
        onConfirm={() =>
          removing &&
          remove.mutate(removing.id, {
            onSuccess: () => {
              toast.success(`${removing.user.full_name} was removed`);
              setRemoving(null);
            },
            onError: (err) => toast.error(errorMessage(err)),
          })
        }
      />
    </div>
  );
}
