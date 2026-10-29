import { expect, test, type Page } from "@playwright/test";

const unique = Date.now().toString(36);
const owner = {
  name: "E2E Owner",
  email: `e2e-owner-${unique}@example.com`,
  password: "Nexora-e2e-pass-2026",
};

/**
 * Visible text only. With Cache Components, Next keeps recently visited routes mounted but
 * hidden (React <Activity>), so plain text locators can also match the previous page.
 */
function text(page: Page, value: string | RegExp, exact = false) {
  return page.getByText(value, { exact }).filter({ visible: true });
}

function field(page: Page, label: string | RegExp, exact = false) {
  return page.getByLabel(label, { exact }).filter({ visible: true });
}

/** Set E2E_SCREENSHOTS=<dir> to save screenshots of key screens for visual review. */
async function snap(page: Page, name: string) {
  const dir = process.env.E2E_SCREENSHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

/** Fail the test on any uncaught browser error (hydration, runtime exceptions). */
function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

test("owner sets up a property, registers a tenant and lets a unit", async ({ page }) => {
  const errors = trackErrors(page);

  // Register and create the organization.
  await page.goto("/register");
  await field(page, "Full name").fill(owner.name);
  await field(page, "Work email").fill(owner.email);
  await field(page, "Password").fill(owner.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await field(page, "Organization name").fill(`E2E Homes ${unique}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: `E2E Homes ${unique}` })).toBeVisible();

  // Property.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Properties" }).click();
  await expect(text(page, "No properties yet")).toBeVisible();
  await page.getByRole("button", { name: "Add property" }).first().click();
  await field(page, "Name", true).fill("Lavington Gardens");
  await field(page, "Town / area").fill("Lavington");
  await field(page, "County").fill("Nairobi");
  await page.getByRole("button", { name: "Create property" }).click();
  await expect(page.getByRole("heading", { name: "Lavington Gardens" })).toBeVisible();
  await expect(text(page, "PRP-0001", true)).toBeVisible();

  // Unit type, then a run of units.
  await expect(text(page, "Add a unit type first")).toBeVisible();
  await page.getByRole("tab", { name: "Unit types" }).click();
  await page.getByRole("button", { name: "Add unit type" }).click();
  await field(page, "Category").selectOption("one_bedroom");
  await field(page, "Default monthly rent").fill("22000");
  await field(page, "Default deposit").fill("22000");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("row", { name: /One bedroom/ })).toBeVisible();

  await page.getByRole("tab", { name: "Units" }).click();
  await page.getByRole("button", { name: "Add several" }).click();
  await field(page, "Prefix").fill("C");
  await field(page, "How many").fill("6");
  await expect(text(page, "C1")).toBeVisible();
  await page.getByRole("button", { name: "Create units" }).click();
  await expect(page.getByRole("button", { name: "Unit C6, Available" })).toBeVisible();

  // Mark one unit under maintenance from the grid.
  await page.getByRole("button", { name: "Unit C6, Available" }).click();
  await field(page, "New status").selectOption("under_maintenance");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("button", { name: "Unit C6, Under maintenance" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Tenant.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Tenants" }).click();
  await page.getByRole("button", { name: "Register tenant" }).first().click();
  await field(page, "Full name").fill("Mwangi Njoroge");
  await field(page, "Phone", true).fill("0711 223 344");
  await field(page, "ID number").fill(`9${unique.slice(-6)}`);
  await page.getByRole("button", { name: "Register tenant" }).last().click();
  await expect(page.getByRole("heading", { name: "Mwangi Njoroge" })).toBeVisible();
  await expect(text(page, "+254711223344")).toBeVisible();

  // Lease from the tenant page.
  await page.getByRole("link", { name: "New lease" }).click();
  await expect(page.getByRole("heading", { name: "New lease" })).toBeVisible();
  await expect(field(page, "Tenant", true)).toHaveValue(/.+/);
  await field(page, "Property").selectOption({ label: "Lavington Gardens (5 available)" });
  await field(page, "Unit", true).selectOption({ index: 1 });
  await expect(field(page, /Monthly rent/)).toHaveValue("22000.00");
  await expect(field(page, /Deposit/)).toHaveValue("22000.00");
  await page.getByRole("button", { name: "Create lease" }).click();
  await expect(page.getByRole("heading", { name: "LSE-0001" })).toBeVisible();
  await expect(text(page, "Active", true)).toBeVisible();

  // Schedule a future rent increase.
  await page.getByRole("button", { name: "Schedule rent change" }).click();
  await field(page, "Effective from").fill("2030-01-01");
  await field(page, /New monthly rent/).fill("24000");
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(text(page, "Scheduled", true)).toBeVisible();
  await snap(page, "lease-detail");

  // Occupancy shows on the property and on the overview.
  await page.getByRole("link", { name: "Lavington Gardens" }).click();
  await expect(page.getByRole("button", { name: /Unit C1, Occupied/ })).toBeVisible();
  await snap(page, "property-detail");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Overview" }).click();
  await expect(text(page, "Occupied units")).toBeVisible();
  // 1 occupied of 6 lettable units (under maintenance still counts as lettable).
  await expect(text(page, "16.7%")).toBeVisible();
  await snap(page, "overview");

  expect(errors).toEqual([]);
});
