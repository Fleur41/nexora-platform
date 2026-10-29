import { expect, test, type Page } from "@playwright/test";

const unique = Date.now().toString(36);
// Dates the server checks against the organization's day (Africa/Nairobi by default).
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date());
const month = (offset: number) => {
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 7);
};

function text(page: Page, value: string | RegExp, exact = false) {
  return page.getByText(value, { exact }).filter({ visible: true });
}

function toast(page: Page, value: string) {
  return page.getByRole("region", { name: /Notifications/ }).getByText(value);
}

function field(page: Page, label: string | RegExp, exact = false) {
  return page.getByLabel(label, { exact }).filter({ visible: true });
}

/** Fast setup through the same API the UI uses (session cookie + CSRF from the browser). */
async function api<T>(page: Page, method: "GET" | "POST" | "PATCH", path: string, body?: unknown, orgId?: string): Promise<T> {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((c) => c.name === "nexora_csrftoken")?.value ?? "";
  const res = await page.request.fetch(`/api/v1${path}`, {
    method,
    data: body,
    headers: { "X-CSRFToken": csrf, ...(orgId ? { "X-Organization-ID": orgId } : {}) },
  });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

test("owner handles a move-out notice through inspection to final settlement, then sends an announcement", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  // --- Setup via API: a tenant two months into a lease with a deposit held ------------------
  await page.goto("/login");
  await api(page, "GET", "/auth/csrf/");
  await api(page, "POST", "/auth/register/", {
    full_name: "Operations Owner",
    email: `e2e-ops-${unique}@example.com`,
    password: "Nexora-e2e-pass-2026",
  });
  const org = await api<{ organization: { id: string } }>(page, "POST", "/organizations/", { name: `Ops Homes ${unique}` });
  const orgId = org.organization.id;
  await page.evaluate((id) => localStorage.setItem("nexora.activeOrganizationId", id), orgId);
  const property = await api<{ id: string }>(page, "POST", "/properties/", { name: "Lavington Court" }, orgId);
  const unitType = await api<{ id: string }>(
    page, "POST", "/unit-types/",
    { property: property.id, name: "Studio", category: "studio", default_rent: "20000", default_deposit: "20000" },
    orgId,
  );
  await api(page, "POST", "/units/bulk/", { property: property.id, unit_type: unitType.id, prefix: "L", start: 1, count: 1 }, orgId);
  const units = await api<{ results: { id: string }[] }>(page, "GET", `/units/?property=${property.id}`, undefined, orgId);
  const tenant = await api<{ id: string }>(page, "POST", "/tenants/", { full_name: "Akinyi Odhiambo", phone: "0711 222 333" }, orgId);
  const lease = await api<{ id: string; reference: string }>(
    page, "POST", "/leases/",
    { tenant: tenant.id, unit: units.results[0]!.id, start_date: `${month(-1)}-01`, monthly_rent: "20000", deposit_amount: "20000", activate: true },
    orgId,
  );
  await api(page, "POST", `/deposits/${lease.id}/transactions/`, {
    kind: "received", amount: "20000", transaction_date: `${month(-1)}-01`, method: "cash", reference: "", reason: "",
  }, orgId);
  await api(page, "POST", "/billing-runs/", { period: month(-1) }, orgId);
  await api(page, "POST", "/billing-runs/", { period: month(0) }, orgId);

  // --- Record the notice from the lease page ---------------------------------------------
  await page.goto(`/dashboard/leases/${lease.id}`);
  await page.getByRole("button", { name: "Record move-out notice" }).click();
  await field(page, "Planned move-out date").fill(today);
  await field(page, "Notes from the tenant (optional)").fill("Relocating to Kisumu for work.");
  await page.getByRole("dialog").getByRole("button", { name: "Record notice" }).click();
  await expect(toast(page, "Move-out notice recorded")).toBeVisible();

  // --- Acknowledge and schedule the inspection -----------------------------------------
  await page.goto("/dashboard/move-outs");
  await page.getByRole("link", { name: "Akinyi Odhiambo" }).click();
  await expect(text(page, "New notice")).toBeVisible();
  await expect(text(page, "Relocating to Kisumu for work.")).toBeVisible();
  await page.getByRole("button", { name: "Acknowledge" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Acknowledge" }).click();
  await expect(toast(page, "Notice acknowledged")).toBeVisible();
  await page.getByRole("button", { name: "Schedule inspection" }).click();
  await field(page, "Date").fill(today);
  await page.getByRole("dialog").getByRole("button", { name: "Schedule" }).click();
  await expect(toast(page, "Inspection scheduled")).toBeVisible();
  await expect(text(page, "The move-out inspection isn't complete")).toBeVisible();
  const moveOutUrl = page.url();

  // --- Inspection: most of the checklist via API, one damaged item through the UI ------
  await page.getByRole("link", { name: /^INS-/ }).click();
  await expect(page.getByRole("heading", { name: "Move-out inspection" })).toBeVisible();
  const inspectionId = page.url().split("/").pop()!;
  const inspection = await api<{ items: { id: string; name: string }[] }>(page, "GET", `/inspections/${inspectionId}/`, undefined, orgId);
  const [damaged, ...rest] = inspection.items;
  await api(page, "PATCH", `/inspections/${inspectionId}/items/`, { items: rest.map((i) => ({ id: i.id, condition: "good" })) }, orgId);
  await page.reload();
  await expect(text(page, "1 of", false)).toBeVisible();
  await field(page, `${damaged!.name} condition`, true).selectOption("damaged");
  await field(page, `${damaged!.name} notes`, true).fill("Cracked, needs replacing");
  await field(page, `${damaged!.name} charge`, true).fill("2500");
  await page.getByRole("button", { name: "Save checklist" }).click();
  await expect(toast(page, "Checklist saved")).toBeVisible();
  await expect(text(page, "Every item has been checked.")).toBeVisible();
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  await field(page, "Keys returned (optional)").fill("2");
  await field(page, "Inspector signature").fill("Operations Owner");
  await page.getByRole("dialog").getByRole("button", { name: "Complete inspection" }).click();
  await expect(toast(page, "Inspection completed")).toBeVisible();
  await expect(text(page, "Signed by inspector: Operations Owner")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save checklist" })).toHaveCount(0);

  // The sidebar stays on screen while a long page (this checklist) scrolls.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Overview" })).toBeInViewport();

  // --- Settlement: damages come from the inspection; refund the rest -------------------
  await page.goto(moveOutUrl);
  await expect(text(page, "Settle and close")).toBeVisible();
  const summary = page.locator("dl");
  await expect(summary.getByText("Deposit held").locator("..")).toContainText("20,000");
  await expect(summary.getByText("Damages deducted").locator("..")).toContainText("2,500");
  await expect(summary.getByText("Deposit applied to balance").locator("..")).toContainText("17,500");
  await field(page, "Use the remaining deposit to clear unpaid rent and charges").uncheck();
  await expect(summary.getByText("Refund to tenant").locator("..")).toContainText("17,500");
  await expect(page.getByRole("button", { name: "Complete move-out" })).toBeDisabled();
  await field(page, "Refund paid by").selectOption({ label: "M-Pesa" });
  await page.getByRole("button", { name: "Complete move-out" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Complete move-out" }).click();
  await expect(toast(page, "Move-out completed")).toBeVisible();
  await expect(text(page, "Moved out", true)).toBeVisible();
  await expect(text(page, "Final settlement")).toBeVisible();

  // The lease is closed and the unit released as chosen.
  const closed = await api<{ status: string }>(page, "GET", `/leases/${lease.id}/`, undefined, orgId);
  expect(closed.status).toBe("ended");

  // --- Announcement (no active tenants left: it reaches nobody, but is recorded) -------
  await page.goto("/dashboard/communications");
  await field(page, "Title").fill("Water interruption on Saturday");
  await field(page, "Message").fill("Nairobi Water will cut supply from 8am to 2pm.");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Send now" }).click();
  await expect(toast(page, "Sent to 0 tenants")).toBeVisible();
  await expect(text(page, "Water interruption on Saturday")).toBeVisible();

  await page.getByRole("tab", { name: "Reminders & channels" }).click();
  await field(page, "Rent due reminder").fill("5");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(toast(page, "Settings saved")).toBeVisible();

  // The notification bell opens the user's inbox.
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await expect(page.getByRole("menu")).toBeVisible();

  expect(errors).toEqual([]);
});
