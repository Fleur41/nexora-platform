import * as React from "react";

import { Label } from "./label";

interface FormFieldProps {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactElement<{ id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string }>;
}

/**
 * Label + control + hint/error wiring with the right aria attributes.
 *
 * Ids get a per-instance suffix: Next keeps recently visited routes mounted (hidden), so a
 * static id like "full_name" could otherwise exist twice and bind labels to the wrong input.
 */
export function FormField({ id: baseId, label, error, hint, children }: FormFieldProps) {
  const id = `${baseId}-${React.useId().replace(/:/g, "")}`;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {React.cloneElement(children, {
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
      })}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
