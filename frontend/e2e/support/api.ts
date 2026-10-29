import { expect, type Page } from "@playwright/test";

/**
 * Fast setup through the same API the UI uses, with the page's session cookie and CSRF
 * token. Use it for data a test needs but isn't about; drive the feature under test via the UI.
 */
export class Api {
  orgId?: string;

  constructor(private readonly page: Page) {}

  async call<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
    const cookies = await this.page.context().cookies();
    const csrf = cookies.find((c) => c.name === "nexora_csrftoken")?.value ?? "";
    const res = await this.page.request.fetch(`/api/v1${path}`, {
      method,
      data: body,
      headers: { "X-CSRFToken": csrf, ...(this.orgId ? { "X-Organization-ID": this.orgId } : {}) },
    });
    expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBeTruthy();
    return (await res.json()) as T;
  }

  /** Upload a file (multipart), e.g. a unit photo to /documents/. */
  async upload<T>(path: string, fields: Record<string, string>, file: { name: string; mimeType: string; buffer: Buffer }): Promise<T> {
    const cookies = await this.page.context().cookies();
    const csrf = cookies.find((c) => c.name === "nexora_csrftoken")?.value ?? "";
    const res = await this.page.request.fetch(`/api/v1${path}`, {
      method: "POST",
      multipart: { ...fields, file },
      headers: { "X-CSRFToken": csrf, ...(this.orgId ? { "X-Organization-ID": this.orgId } : {}) },
    });
    expect(res.ok(), `POST ${path}: ${await res.text()}`).toBeTruthy();
    return (await res.json()) as T;
  }

  get = <T>(path: string) => this.call<T>("GET", path);
  post = <T>(path: string, body?: unknown) => this.call<T>("POST", path, body);
  patch = <T>(path: string, body?: unknown) => this.call<T>("PATCH", path, body);

  /** Register an owner, create their organization and make it the active one in the browser. */
  async signUpOwner(name: string, email: string, password: string, organization: string): Promise<string> {
    await this.page.goto("/login");
    await this.get("/auth/csrf/");
    await this.post("/auth/register/", { full_name: name, email, password });
    const org = await this.post<{ organization: { id: string } }>("/organizations/", { name: organization });
    this.orgId = org.organization.id;
    await this.page.evaluate((id) => localStorage.setItem("nexora.activeOrganizationId", id), this.orgId);
    return this.orgId;
  }

  /** A property with `count` units of one type; returns the unit ids in order. */
  async propertyWithUnits(name: string, rent: string, deposit: string, prefix: string, count: number): Promise<{ propertyId: string; unitIds: string[] }> {
    const property = await this.post<{ id: string }>("/properties/", { name });
    const unitType = await this.post<{ id: string }>("/unit-types/", {
      property: property.id, name: "Standard", category: "one_bedroom", default_rent: rent, default_deposit: deposit,
    });
    await this.post("/units/bulk/", { property: property.id, unit_type: unitType.id, prefix, start: 1, count });
    const units = await this.get<{ results: { id: string }[] }>(`/units/?property=${property.id}&ordering=number`);
    return { propertyId: property.id, unitIds: units.results.map((u) => u.id) };
  }
}
