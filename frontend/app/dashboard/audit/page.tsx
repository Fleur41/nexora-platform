"use client";

import { ScrollText, Search } from "lucide-react";
import * as React from "react";

import { PageHeader } from "@/components/layout/page-header";
import { useOrganization } from "@/components/providers/organization-provider";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
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
import { useAuditLogs } from "@/features/audit/api";
import { describeAction, describeChanges } from "@/features/audit/describe";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { errorMessage } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/utils";

const PAGE_SIZE = 25;

export default function AuditLogPage() {
  const { can, current } = useOrganization();
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const debounced = useDebouncedValue(search, 300);
  const allowed = can("audit.view");
  const logs = useAuditLogs({ search: debounced, page }, allowed);

  if (!allowed) {
    return <Alert variant="error" title="You don't have permission to view the audit log." />;
  }

  return (
    <>
      <PageHeader
        title="Audit log"
        description="An append-only record of security and administrative changes. Entries cannot be edited or deleted."
      />
      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          aria-label="Search audit log"
          placeholder="Search by action, person or record"
          className="pl-9"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>
      {logs.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : logs.isError ? (
        <ErrorState message={errorMessage(logs.error)} onRetry={() => logs.refetch()} />
      ) : logs.data.results.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No entries found"
          description={debounced ? "Try a different search." : "Activity will appear here."}
        />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Event</TableHead>
                <TableHead className="hidden lg:table-cell">Changes</TableHead>
                <TableHead className="hidden md:table-cell">By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.data.results.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(entry.created_at, current.organization.timezone)}
                  </TableCell>
                  <TableCell>
                    <p>{describeAction(entry)}</p>
                    <p className="font-mono text-xs text-muted-foreground">{entry.action}</p>
                  </TableCell>
                  <TableCell className="hidden max-w-sm lg:table-cell">
                    <ul className="space-y-0.5 text-xs text-muted-foreground">
                      {describeChanges(entry).map((line) => (
                        <li key={line} className="truncate" title={line}>
                          {line}
                        </li>
                      ))}
                    </ul>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {entry.actor_email || "System"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {logs.data && (
        <Pagination page={page} pageSize={PAGE_SIZE} count={logs.data.count} onPageChange={setPage} />
      )}
    </>
  );
}
