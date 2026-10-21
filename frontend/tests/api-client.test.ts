import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, buildUrl } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { setActiveOrganizationId } from "@/lib/api/organization-store";

function jsonResponse(status: number, body: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api client", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    document.cookie = "nexora_csrftoken=csrf-123";
    setActiveOrganizationId("org-1");
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    setActiveOrganizationId(null);
  });

  it("sends the active organization header and no CSRF token on GET", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    await api.get("/members/", { search: "jane", role: "", page: 2 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/members/?search=jane&page=2");
    expect(init.headers["X-Organization-ID"]).toBe("org-1");
    expect(init.headers["X-CSRFToken"]).toBeUndefined();
    expect(init.credentials).toBe("same-origin");
  });

  it("sends the CSRF token on unsafe methods", async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { id: "x" }));
    await api.post("/invitations/", { email: "a@b.co" });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers["X-CSRFToken"]).toBe("csrf-123");
    expect(init.body).toBe(JSON.stringify({ email: "a@b.co" }));
  });

  it("omits the organization header for unscoped calls", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    await api.get("/auth/me/", undefined, { scoped: false });
    expect(fetchMock.mock.calls[0]![1].headers["X-Organization-ID"]).toBeUndefined();
  });

  it("parses the backend error envelope into ApiError with field details", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        error: { code: "invalid", message: "Some fields are invalid.", details: { email: ["Taken."] } },
      }),
    );
    const err = await api.post("/auth/register/", {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.fieldError("email")).toBe("Taken.");
  });

  it("reports network failures as status 0 with a friendly message", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const err = await api.get("/members/").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/could not reach/i);
  });

  it("returns undefined for 204 responses", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.delete("/members/1/")).resolves.toBeUndefined();
  });

  it("builds URLs without empty query values", () => {
    expect(buildUrl("audit-logs/", { search: undefined, page: 1 })).toBe("/api/v1/audit-logs/?page=1");
  });
});
