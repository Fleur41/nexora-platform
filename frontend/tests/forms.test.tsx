import { renderHook } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/errors";
import { applyServerErrors, bannerError, moneyString } from "@/lib/forms";

describe("moneyString", () => {
  const schema = moneyString();
  it.each(["0", "25000", "25000.5", "25000.50"])("accepts %s", (v) => {
    expect(schema.safeParse(v).success).toBe(true);
  });
  it.each(["-1", "1.234", "1,000", "abc", ""])("rejects %s", (v) => {
    expect(schema.safeParse(v).success).toBe(false);
  });
});

describe("server error mapping", () => {
  it("puts Django field errors on matching fields and keeps others for the banner", () => {
    const { result } = renderHook(() => useForm({ defaultValues: { number: "", floor: "" } }));
    const fieldErr = new ApiError(400, {
      error: { code: "invalid", message: "Some fields are invalid.", details: { number: ["Taken."] } },
    });
    expect(applyServerErrors(fieldErr, result.current)).toBe(true);
    expect(result.current.getFieldState("number").error?.message).toBe("Taken.");

    const conflict = new ApiError(409, { error: { code: "conflict", message: "Unit type mismatch." } });
    const matched = applyServerErrors(conflict, result.current);
    expect(matched).toBe(false);
    expect(bannerError(conflict, matched)).toBe("Unit type mismatch.");
  });
});
