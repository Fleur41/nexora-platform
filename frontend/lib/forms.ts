import type { FieldValues, Path, UseFormReturn } from "react-hook-form";
import { z } from "zod";

import { ApiError } from "@/lib/api/errors";

/** Non-negative amount with up to 2 decimals, kept as a string (no float rounding). */
export const moneyString = (label = "an amount") =>
  z
    .string()
    .trim()
    .regex(/^\d{1,12}(\.\d{1,2})?$/, `Enter ${label} as a number, e.g. 25000 or 25000.50`);

export const optionalText = (max: number) => z.string().trim().max(max);

/**
 * Copy Django field errors onto matching form fields. Returns true if any field matched,
 * so callers can decide whether to also show a general error banner.
 */
export function applyServerErrors<T extends FieldValues, TOut extends FieldValues = T>(
  error: unknown,
  form: UseFormReturn<T, unknown, TOut>,
): boolean {
  if (!(error instanceof ApiError)) return false;
  let matched = false;
  const known = Object.keys(form.getValues());
  for (const [field, messages] of Object.entries(error.details)) {
    if (known.includes(field) && messages[0]) {
      form.setError(field as Path<T>, { message: messages[0] });
      matched = true;
    }
  }
  return matched;
}

/** Banner text for an error not already shown next to a field. */
export function bannerError(error: unknown, matchedFields: boolean): string | null {
  if (!error || matchedFields) return null;
  if (error instanceof ApiError) {
    return error.details.non_field_errors?.[0] ?? error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}
