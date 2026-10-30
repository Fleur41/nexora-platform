"use client";

import { BarChart3, Download, FileSpreadsheet, FileText } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { useOrganization } from "@/components/providers/organization-provider";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePropertyOptions } from "@/features/properties/api";
import { downloadReport, type ExportFormat, useReport, useReportList } from "@/features/reports/api";
import { errorMessage } from "@/lib/api/errors";
import { cn, formatDay, formatMoney, todayIn } from "@/lib/utils";
import type { Report, ReportCell, ReportKey, ReportValueKind } from "@/types/api";

import { BilledCollectedChart } from "./billed-collected-chart";

const PRESETS = {
  "this-month": "This month",
  "last-month": "Last month",
  "this-year": "This year",
  "last-year": "Last year",
  custom: "Custom dates",
} as const;
type Preset = keyof typeof PRESETS;

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

function presetRange(preset: Exclude<Preset, "custom">, today: string) {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const month = m - 1;
  switch (preset) {
    case "this-month":
      return { start: iso(y, month, 1), end: iso(y, month + 1, 0) };
    case "last-month":
      return { start: iso(y, month - 1, 1), end: iso(y, month, 0) };
    case "this-year":
      return { start: iso(y, 0, 1), end: iso(y, 11, 31) };
    case "last-year":
      return { start: iso(y - 1, 0, 1), end: iso(y - 1, 11, 31) };
  }
}

export function formatCell(value: ReportCell, kind: ReportValueKind, currency: string): string {
  if (value === null || value === "") return kind === "text" ? "" : "—";
  switch (kind) {
    case "money":
      return formatMoney(value, currency);
    case "percent":
      return `${value}%`;
    case "date":
      // A label such as "Total" can sit in a date column on the totals row.
      return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? formatDay(String(value)) : String(value);
    case "number":
      return Number(value).toLocaleString("en-KE");
    default:
      return String(value);
  }
}

export function ReportsPage() {
  const { can, current } = useOrganization();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const allowed = can("reports.view");
  const list = useReportList(allowed);
  const properties = usePropertyOptions(allowed);
  const today = todayIn(current.organization.timezone);

  // The selection lives in the URL so a report can be bookmarked or shared with a colleague.
  const reportKey = (params.get("report") as ReportKey | null) ?? "financial-summary";
  const preset = (params.get("period") as Preset | null) ?? "this-month";
  const range =
    preset === "custom"
      ? { start: params.get("start") ?? presetRange("this-month", today).start, end: params.get("end") ?? presetRange("this-month", today).end }
      : presetRange(preset, today);
  const property = params.get("property") ?? "";
  const query = { ...range, ...(property ? { property } : {}) };
  const report = useReport(reportKey, query, allowed);
  const [exporting, setExporting] = React.useState<ExportFormat | null>(null);

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  if (!allowed) return <Alert variant="error" title="You don't have permission to view reports." />;
  const reports = list.data?.filter((r) => r.available) ?? [];
  const isArrears = reportKey === "arrears";

  const exportAs = async (format: ExportFormat) => {
    setExporting(format);
    try {
      await downloadReport(reportKey, query, format);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setExporting(null);
    }
  };

  return (
    <>
      <PageHeader title="Reports" description="Financial and occupancy reports for any month, year or dates you choose. Download them for your accountant." />

      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-muted p-1" role="tablist" aria-label="Report">
        {(reports.length ? reports : [{ key: reportKey, title: "…" }]).map((r) => (
          <button
            key={r.key}
            type="button"
            role="tab"
            aria-selected={r.key === reportKey}
            onClick={() => update({ report: r.key })}
            className={cn(
              "shrink-0 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
              r.key === reportKey && "bg-background text-foreground shadow-sm",
            )}
          >
            {r.title}
          </button>
        ))}
      </div>

      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center">
        {!isArrears && (
          <NativeSelect aria-label="Period" className="lg:w-40" value={preset} onChange={(e) => update({ period: e.target.value, start: null, end: null })}>
            {Object.entries(PRESETS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </NativeSelect>
        )}
        {!isArrears && preset === "custom" && (
          <div className="flex items-center gap-2">
            <Input type="date" aria-label="From" className="w-40" value={range.start} max={range.end} onChange={(e) => e.target.value && update({ start: e.target.value })} />
            <span className="text-sm text-muted-foreground">to</span>
            <Input type="date" aria-label="To" className="w-40" value={range.end} min={range.start} onChange={(e) => e.target.value && update({ end: e.target.value })} />
          </div>
        )}
        <NativeSelect aria-label="Property" className="lg:w-56" value={property} onChange={(e) => update({ property: e.target.value || null })}>
          <option value="">All properties</option>
          {properties.data?.results.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </NativeSelect>
        <div className="flex gap-2 lg:ml-auto">
          <Button variant="outline" size="sm" loading={exporting === "pdf"} onClick={() => exportAs("pdf")}><FileText /> PDF</Button>
          <Button variant="outline" size="sm" loading={exporting === "xlsx"} onClick={() => exportAs("xlsx")}><FileSpreadsheet /> Excel</Button>
          <Button variant="outline" size="sm" loading={exporting === "csv"} onClick={() => exportAs("csv")}><Download /> CSV</Button>
        </div>
      </div>

      {report.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : report.isError ? (
        <ErrorState message={errorMessage(report.error)} onRetry={() => report.refetch()} />
      ) : (
        <ReportView report={report.data} loading={report.isFetching} />
      )}
    </>
  );
}

function ReportView({ report: r, loading }: { report: Report; loading: boolean }) {
  return (
    <div className={cn("space-y-6 transition-opacity", loading && "opacity-60")} aria-busy={loading}>
      <div>
        <h2 className="text-lg font-semibold">{r.title} · {r.period.label}</h2>
        <p className="text-sm text-muted-foreground">
          {r.subtitle} {r.property ? `Property: ${r.property}.` : "All properties."} Amounts in {r.currency}.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {r.summary.map((s) => (
          <Card key={s.label} className="py-0">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{formatCell(s.value, s.kind, r.currency)}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      {r.chart && r.chart.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BarChart3 className="size-4 text-muted-foreground" /> Billed and received by month</CardTitle>
          </CardHeader>
          <CardContent>
            <BilledCollectedChart data={r.chart} currency={r.currency} />
          </CardContent>
        </Card>
      )}
      {r.sections.map((section) => (
        <Card key={section.title}>
          <CardHeader>
            <CardTitle>{section.title}</CardTitle>
            {section.note && <CardDescription>{section.note}</CardDescription>}
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {section.rows.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground">Nothing to show for this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {section.columns.map((c) => (
                        <TableHead key={c.key} className={cn("whitespace-nowrap", isNumeric(c.kind) && "text-right")}>{c.label}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {section.rows.map((row, i) => (
                      <TableRow key={i}>
                        {section.columns.map((c) => (
                          <TableCell key={c.key} className={cn("whitespace-nowrap", isNumeric(c.kind) && "text-right tabular-nums")}>
                            {formatCell(row[c.key] ?? null, c.kind, r.currency)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                    {section.totals && (
                      <TableRow className="bg-muted/50 font-semibold hover:bg-muted/50">
                        {section.columns.map((c) => (
                          <TableCell key={c.key} className={cn("whitespace-nowrap", isNumeric(c.kind) && "text-right tabular-nums")}>
                            {section.totals![c.key] === undefined || section.totals![c.key] === null ? "" : formatCell(section.totals![c.key]!, c.kind, r.currency)}
                          </TableCell>
                        ))}
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

const isNumeric = (kind: ReportValueKind) => kind === "money" || kind === "number" || kind === "percent";
