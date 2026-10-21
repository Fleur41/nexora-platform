"use client";

import { Tabs as Primitive } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

export const Tabs = Primitive.Root;

export function TabsList({ className, ...props }: React.ComponentProps<typeof Primitive.List>) {
  return (
    <Primitive.List
      className={cn(
        "inline-flex h-10 items-center rounded-lg bg-muted p-1 text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Trigger>) {
  return (
    <Primitive.Trigger
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export const TabsContent = Primitive.Content;
