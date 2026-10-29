import { expect, test, type Page } from "@playwright/test";

const unique = Date.now().toString(36);

function text(page: Page, value: string | RegExp, exact = false) {
  return page.getByText(value, { exact }).filter({ visible: true });
}

function field(page: Page, label: string | RegExp, exact = false) {
  return page.getByLabel(label, { exact }).filter({ visible: true });
}

async function api<T>(page: Page, method: "GET" | "POST", path: string, body?: unknown, orgId?: string): Promise<T> {
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

test("owner sets up a paybill, records a payment with a receipt and reconciles a bank import", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/login");
  await api(page, "GET", "/auth/csrf/");
  await api(page, "POST", "/auth/register/", {
    full_name: "Payments Owner",
    email: `e2e-payments-${unique}@example.com`,
    password: "Nexora-e2e-pass-2026",
  });
  const org = await api<{ organization: { id: string } }>(page, "POST", "/organizations/", { name: `Pay Homes ${unique}` });
  const orgId = org.organization.id;
  await page.evaluate((id) => localStorage.setItem("nexora.activeOrganizationId", id), orgId);
  const property = await api<{ id: string }>(page, "POST", "/properties/", { name: "Kasarani Courts" }, orgId);
  const unitType = await api<{ id: string }>(page, "POST", "/unit-types/", { property: property.id, name: "1BR", category: "one_bedroom", default_rent: "15000" }, orgId);
  await api(page, "POST", "/units/bulk/", { property: property.id, unit_type: unitType.id, prefix: "K", start: 1, count: 1 }, orgId);
  const units = await api<{ results: { id: string }[] }>(page, "GET", `/units/?property=${property.id}`, undefined, orgId);
  const tenant = await api<{ id: string }>(page, "POST", "/tenants/", { full_name: "Wairimu Njeri", phone: "0711 999 000" }, orgId);
  const lease = await api<{ id: string; reference: string }>(
    page, "POST", "/leases/",
    { tenant: tenant.id, unit: units.results[0]!.id, start_date: "2026-08-01", monthly_rent: "15000", activate: true },
    orgId,
  );
  await api(page, "POST", "/billing-runs/", { period: "2026-08" }, orgId);
  await api(page, "POST", "/billing-runs/", { period: "2026-09" }, orgId);

  // --- Payment settings ------------------------------------------------------------------
  await page.goto("/dashboard/settings/payments");
  await expect(text(page, "No payment methods yet")).toBeVisible();
  await page.getByRole("button", { name: "Add payment method" }).first().click();
  await field(page, "Name", true).fill("Rent paybill");
  await field(page, "Paybill number").fill("600987");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(text(page, "600987")).toBeVisible();
  await page.getByRole("button", { name: "Add payment method" }).click();
  await field(page, "Type").selectOption("bank");
  await field(page, "Name", true).fill("Equity account");
  await field(page, "Bank", true).fill("Equity Bank");
  await field(page, "Account number").fill("0170123456");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(text(page, "0170123456")).toBeVisible();

  // --- Record a partial payment from the lease ------------------------------------------------
  await page.goto(`/dashboard/leases/${lease.id}`);
  await expect(text(page, "How this tenant pays")).toBeVisible();
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(text(page, /Balance owed:\s*Ksh\s30,000/)).toBeVisible();
  await field(page, /^Amount/).fill("20000");
  await field(page, "M-Pesa code").fill("qkx12abc34");
  await page.getByRole("button", { name: "Record payment" }).last().click();
  await expect(text(page, /Receipt RCT-00001 issued/)).toBeVisible();

  // --- Receipt -------------------------------------------------------------------------------------
  await page.goto("/dashboard/payments");
  await page.getByRole("link", { name: "RCT-00001" }).click();
  await expect(page.getByRole("heading", { name: "RCT-00001" })).toBeVisible();
  await expect(text(page, "QKX12ABC34")).toBeVisible();
  await page.getByRole("link", { name: "Receipt" }).click();
  await expect(text(page, "RECEIPT", true)).toBeVisible();
  await expect(text(page, "Wairimu Njeri")).toBeVisible();
  await expect(text(page, /Account balance now:\s*Ksh\s10,000/)).toBeVisible();
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/receipt.png`, fullPage: true });

  // --- Bank import + reconciliation ------------------------------------------------------------------
  await page.goto("/dashboard/payments?tab=imports");
  const csv = `Date,Narration,Reference,Credit\n2026-09-03,CASH DEPOSIT WAIRIMU,FT88812,6000\n2026-09-04,RENT ${lease.reference},FT88813,4000\n`;
  await field(page, "CSV file").setInputFiles({ name: "equity-sept.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Import" }).click();
  await expect(text(page, /2 imported · 1 matched/)).toBeVisible();

  await page.getByRole("tab", { name: /Unmatched/ }).click();
  await expect(page.getByRole("cell", { name: /CASH DEPOSIT WAIRIMU/ })).toBeVisible();
  await page.getByRole("button", { name: "Match" }).click();
  await field(page, "Lease", true).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Match payment" }).click();
  await expect(text(page, "Nothing to reconcile")).toBeVisible();

  // 30,000 billed − 20,000 − 4,000 − 6,000 = 0
  await page.goto(`/dashboard/leases/${lease.id}`);
  await expect(text(page, "Balance", true)).toBeVisible();
  await expect(page.locator("p", { hasText: /^Ksh\s0$/ }).filter({ visible: true }).first()).toBeVisible();
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/lease-paid.png`, fullPage: true });

  expect(errors).toEqual([]);
});
