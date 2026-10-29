"use client";

import { Bell, CheckCheck } from "lucide-react";
import { useRouter } from "next/navigation";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useInbox, useMarkRead, useUnreadCount } from "@/features/notifications/api";
import { cn, formatDateTime } from "@/lib/utils";

/** In-app inbox. Notifications belong to the user, so the bell works the same in the dashboard and the portal. */
export function NotificationBell({ timeZone, showOrganization }: { timeZone: string; showOrganization?: boolean }) {
  const router = useRouter();
  const count = useUnreadCount();
  const inbox = useInbox();
  const markRead = useMarkRead();
  const unread = count.data?.count ?? 0;
  const items = inbox.data?.results ?? [];

  return (
    <DropdownMenu onOpenChange={(open) => { if (open) inbox.refetch(); }}>
      <DropdownMenuTrigger className="relative flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
        <span className="sr-only">{unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">Notifications</span>
          {unread > 0 && (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs font-normal hover:text-foreground"
              onClick={(e) => { e.preventDefault(); markRead.mutate("all"); }}
            >
              <CheckCheck className="size-3.5" /> Mark all read
            </button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">{inbox.isPending ? "Loading…" : "You're all caught up."}</p>
          ) : (
            items.map((n) => (
              <DropdownMenuItem
                key={n.id}
                className="flex-col items-start gap-0.5 whitespace-normal"
                onSelect={() => {
                  if (!n.read_at) markRead.mutate(n.id);
                  if (n.link) router.push(n.link);
                }}
              >
                <span className={cn("flex w-full items-start gap-2 text-sm", !n.read_at && "font-medium")}>
                  {!n.read_at && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                  {n.title}
                </span>
                {n.body && <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span>}
                <span className="text-[11px] text-muted-foreground">
                  {formatDateTime(n.created_at, timeZone)}
                  {showOrganization && n.organization_name && ` · ${n.organization_name}`}
                </span>
              </DropdownMenuItem>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
