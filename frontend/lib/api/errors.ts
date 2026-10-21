import type { ApiErrorBody } from "@/types/api";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, string[]>;

  constructor(status: number, body: Partial<ApiErrorBody> | null) {
    const error = body?.error;
    super(error?.message ?? defaultMessage(status));
    this.name = "ApiError";
    this.status = status;
    this.code = error?.code ?? "error";
    this.details = normalizeDetails(error?.details);
  }

  /** First message for a given field, if the backend rejected it. */
  fieldError(field: string): string | undefined {
    return this.details[field]?.[0];
  }
}

function normalizeDetails(details: Record<string, string[] | string> | undefined) {
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(details ?? {})) {
    out[key] = Array.isArray(value) ? value.map(String) : [String(value)];
  }
  return out;
}

function defaultMessage(status: number): string {
  if (status === 0) return "Could not reach the Nexora server. Check your connection.";
  if (status === 401 || status === 403) return "You do not have access to this resource.";
  if (status === 404) return "Not found.";
  if (status >= 500) return "Something went wrong on our side. Please try again.";
  return "The request could not be completed.";
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}
