import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api, apiDownload } from "@/lib/api/client";
import { saveBlob } from "@/lib/download";
import { useOrgKey } from "@/lib/org-query";
import type { Report, ReportKey, ReportListItem } from "@/types/api";

export type ReportParams = { start: string; end: string; property?: string };
export type ExportFormat = "csv" | "xlsx" | "pdf";

export function useReportList(enabled = true) {
  const key = useOrgKey();
  return useQuery({ queryKey: key("reports"), queryFn: () => api.get<ReportListItem[]>("/reports/"), enabled });
}

export function useReport(report: ReportKey, params: ReportParams, enabled = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("reports", report, params),
    queryFn: () => api.get<Report>(`/reports/${report}/`, params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Download a report file and hand it to the browser as a save. */
export async function downloadReport(report: ReportKey, params: ReportParams, format: ExportFormat) {
  const query = new URLSearchParams({ ...params, export: format });
  if (!params.property) query.delete("property");
  const blob = await apiDownload(`/reports/${report}/?${query.toString()}`);
  saveBlob(blob, `${report}-${params.start}-to-${params.end}.${format}`);
}
