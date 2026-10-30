import fs from "node:fs";

import { Api } from "../support/api";
import { month, today } from "../support/data";
import { expect, test } from "../support/fixtures";

const unique = Date.now().toString(36);

test("owner reads financial and occupancy reports and downloads them", async ({ app, page }) => {
  // --- Setup: two months billed for one tenant, part paid; a second unit vacant ----------
  const api = new Api(page);
  await api.signUpOwner("Reports Owner", `e2e-reports-${unique}@example.com`, "Nexora-e2e-pass-2026", `Report Homes ${unique}`);
  const { unitIds } = await api.propertyWithUnits("Lavington Court", "20000", "20000", "L", 2);
  const tenant = await api.post<{ id: string }>("/tenants/", { full_name: "Otieno Ouma", phone: "0712 000 111" });
  const lease = await api.post<{ id: string }>("/leases/", {
    tenant: tenant.id, unit: unitIds[0], start_date: `${month(-1)}-01`, monthly_rent: "20000", deposit_amount: "0", activate: true,
  });
  await api.post("/billing-runs/", { period: month(-1) });
  await api.post("/billing-runs/", { period: month(0) });
  await api.post("/payments/", {
    lease: lease.id, amount: "30000", received_on: today, method: "cash", reference: "", payer_name: "", payer_phone: "", notes: "",
  });

  // --- Financial summary for this year -----------------------------------------------------
  await page.goto("/dashboard");
  await app.reports.open();
  await app.reports.choose("Financial summary");
  await app.reports.setPeriod("This year");
  await expect(app.reports.summary("Net billed")).toHaveText(/40,000/);
  await expect(app.reports.summary("Received")).toHaveText(/30,000/);
  await expect(app.reports.summary("Collection rate")).toHaveText("75.0%");
  await expect(app.reports.summary("Owed at period end")).toHaveText(/10,000/);
  await expect(page.getByRole("group", { name: /Billed and received per month/ })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`billed Ksh 20,000, received`) }).first().focus();
  await expect(page.getByRole("status").filter({ hasText: "Billed" })).toBeVisible();
  await app.reports.snap("reports-financial");
  await page.getByRole("button", { name: "Show as table" }).click();
  await expect(page.getByRole("cell", { name: /20,000/ }).first()).toBeVisible();

  // --- Rent roll, occupancy, property filter ----------------------------------------------
  await app.reports.choose("Rent roll");
  await expect(page.getByRole("row", { name: /Otieno Ouma/ })).toContainText("10,000");
  await app.reports.choose("Occupancy");
  await expect(app.reports.summary("Occupancy now")).toHaveText("50.0%");
  await expect(page.getByRole("row", { name: /L2/ })).toBeVisible(); // the vacant unit
  await app.reports.field("Property").selectOption({ label: "Lavington Court" });
  await expect(app.reports.text(/Property: Lavington Court\./)).toBeVisible();
  await expect(page).toHaveURL(/report=occupancy.*property=/);

  // --- Downloads ------------------------------------------------------------------------
  await app.reports.choose("Rent roll");
  const pdf = await app.reports.download("PDF");
  expect(pdf.suggestedFilename()).toMatch(/^rent-roll-.*\.pdf$/);
  expect(fs.readFileSync(await pdf.path()).subarray(0, 4).toString()).toBe("%PDF");
  const xlsx = await app.reports.download("Excel");
  expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
  const csv = await app.reports.download("CSV");
  expect(fs.readFileSync(await csv.path(), "utf8")).toContain("Otieno Ouma");
});
