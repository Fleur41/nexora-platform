import { expect, test, type Page } from "@playwright/test";

import { sameOrigin } from "../support/api";

const unique = Date.now().toString(36);

function text(page: Page, value: string | RegExp, exact = false) {
  return page.getByText(value, { exact }).filter({ visible: true });
}

function field(page: Page, label: string | RegExp, exact = false) {
  return page.getByLabel(label, { exact }).filter({ visible: true });
}

/** Fast setup through the same API the UI uses (session cookie + CSRF from the browser). */
async function api<T>(page: Page, method: "GET" | "POST", path: string, body?: unknown, orgId?: string): Promise<T> {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((c) => c.name === "nexora_csrftoken")?.value ?? "";
  const res = await page.request.fetch(`/api/v1${path}`, {
    method,
    data: body,
    headers: { ...sameOrigin(page), "X-CSRFToken": csrf, ...(orgId ? { "X-Organization-ID": orgId } : {}) },
  });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

test("owner configures a charge, bills a month, credits an invoice and records a deposit", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  // --- Setup via API ---------------------------------------------------------------
  await page.goto("/login");
  await api(page, "GET", "/auth/csrf/");
  await api(page, "POST", "/auth/register/", {
    full_name: "Billing Owner",
    email: `e2e-billing-${unique}@example.com`,
    password: "Nexora-e2e-pass-2026",
  });
  const org = await api<{ organization: { id: string } }>(page, "POST", "/organizations/", { name: `Billing Homes ${unique}` });
  const orgId = org.organization.id;
  await page.evaluate((id) => localStorage.setItem("nexora.activeOrganizationId", id), orgId);
  const property = await api<{ id: string }>(page, "POST", "/properties/", { name: "Ngong Road Flats" }, orgId);
  const unitType = await api<{ id: string }>(
    page, "POST", "/unit-types/",
    { property: property.id, name: "Studio", category: "studio", default_rent: "20000", default_deposit: "20000" },
    orgId,
  );
  await api(page, "POST", "/units/bulk/", { property: property.id, unit_type: unitType.id, prefix: "S", start: 1, count: 2 }, orgId);
  const units = await api<{ results: { id: string }[] }>(page, "GET", `/units/?property=${property.id}`, undefined, orgId);
  const tenant = await api<{ id: string }>(page, "POST", "/tenants/", { full_name: "Kipchoge Rotich", phone: "0733 000 111" }, orgId);
  const lease = await api<{ id: string }>(
    page, "POST", "/leases/",
    { tenant: tenant.id, unit: units.results[0]!.id, start_date: "2026-08-01", monthly_rent: "20000", deposit_amount: "20000", activate: true },
    orgId,
  );

  // --- Charge rule via the UI ---------------------------------------------------------
  await page.goto("/dashboard/charges");
  await expect(text(page, "No charge rules yet")).toBeVisible();
  await page.getByRole("button", { name: "Add rule" }).click();
  await field(page, "Charge", true).selectOption({ label: "Security" });
  await field(page, /^Amount/).fill("1500");
  await field(page, "Effective from").fill("2026-08-01");
  await page.getByRole("button", { name: "Save rule" }).click();
  await expect(page.getByRole("row", { name: /Security.*All properties/ })).toBeVisible();

  // --- Billing run with preview -------------------------------------------------------------
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Billing" }).click();
  await page.getByRole("button", { name: "Generate invoices" }).click();
  await field(page, "Month").fill("2026-08");
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(text(page, "Security · Aug 2026")).toBeVisible();
  await expect(page.getByRole("dialog").getByText(/1\s+invoice totalling/)).toContainText("21,500");
  await page.getByRole("button", { name: "Post invoices" }).click();
  await expect(page.getByRole("link", { name: "INV-00001" })).toBeVisible();

  // Running the same month again finds nothing new.
  await page.getByRole("button", { name: "Generate invoices" }).click();
  await field(page, "Month").fill("2026-08");
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(text(page, "Nothing new to bill for this month.")).toBeVisible();
  await page.keyboard.press("Escape");

  // --- Credit an invoice ---------------------------------------------------------------------
  await page.getByRole("link", { name: "INV-00001" }).click();
  await expect(page.getByRole("heading", { name: "INV-00001" })).toBeVisible();
  await page.getByRole("button", { name: "Credit" }).click();
  await field(page, /^Amount/).fill("500");
  await field(page, "Reason").fill("Security gate broken for a week");
  await page.getByRole("button", { name: "Apply credit" }).click();
  await expect(text(page, /Credit CRN-00001/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Void/ })).toBeDisabled(); // credited invoices can't be voided

  // --- Lease account and deposit ------------------------------------------------------------------
  await page.goto(`/dashboard/leases/${lease.id}`);
  await expect(text(page, "Balance", true)).toBeVisible();
  await expect(page.getByText("Ksh 21,000").filter({ visible: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Record received" }).click();
  await field(page, /^Amount/).fill("20000");
  await field(page, /Reference/).fill("QXT4ABC123");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(text(page, "Held now")).toBeVisible();
  await expect(text(page, /QXT4ABC123/)).toBeVisible();
  // The deposit is not added to what the tenant owes.
  await expect(page.getByText("Ksh 21,000").filter({ visible: true }).first()).toBeVisible();

  if (process.env.E2E_SCREENSHOTS) {
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/lease-billing.png`, fullPage: true });
    await page.goto("/dashboard/billing");
    await expect(page.getByRole("link", { name: "INV-00001" })).toBeVisible();
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/billing.png`, fullPage: true });
  }
  expect(errors).toEqual([]);
});
