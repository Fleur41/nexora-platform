import { Api } from "../support/api";
import { photo } from "../support/data";
import { expect, test } from "../support/fixtures";

const unique = Date.now().toString(36);

test("owner publishes a vacant unit; a visitor requests a viewing; staff book it and close it", async ({ app, page, browser, baseURL }) => {
  // --- Setup: a property in Westlands with a vacant unit and a photo -------------------------
  const api = new Api(page);
  await api.signUpOwner("Listings Owner", `e2e-listings-${unique}@example.com`, "Nexora-e2e-pass-2026", `Let Homes ${unique}`);
  const property = await api.post<{ id: string }>("/properties/", { name: `Sarit Court ${unique}`, town: "Westlands", county: "Nairobi" });
  const unitType = await api.post<{ id: string }>("/unit-types/", {
    property: property.id, name: "Two bedroom", category: "two_bedroom", bedrooms: 2, default_rent: "45000", default_deposit: "45000",
  });
  await api.post("/units/bulk/", { property: property.id, unit_type: unitType.id, prefix: "S", start: 1, count: 1 });
  const units = await api.get<{ results: { id: string }[] }>(`/units/?property=${property.id}`);
  await api.upload("/documents/", { unit: units.results[0]!.id, category: "photo" }, { name: "lounge.png", mimeType: "image/png", buffer: photo });

  // --- Staff publish it ------------------------------------------------------------------------
  await page.goto("/dashboard");
  await app.reports.openFromSidebar("Listings");
  await app.reports.button("New listing").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Property").selectOption({ label: `Sarit Court ${unique}` });
  await dialog.getByLabel("Unit", { exact: true }).selectOption({ index: 1 });
  await dialog.getByLabel("Title").fill(`Bright 2-bedroom in Westlands ${unique}`);
  await dialog.getByLabel("Description").fill("Balcony, lift and borehole water.");
  await dialog.getByRole("button", { name: /^Use photo/ }).click();
  await expect(dialog.getByRole("button", { name: /^Remove photo/ })).toBeVisible();
  await app.reports.snap("listing-editor");
  await dialog.getByRole("button", { name: "Save listing" }).click();
  await app.reports.expectToast("Listing is live");
  await expect(page.getByText("Live", { exact: true })).toBeVisible();

  // --- A visitor (not signed in) finds it and requests a viewing ----------------------------------
  const visitorContext = await browser.newContext({ baseURL });
  const visitor = await visitorContext.newPage();
  await visitor.goto(`/listings?q=${unique}`);
  await expect(visitor.getByText("1 home to let")).toBeVisible();
  const shots = process.env.E2E_SCREENSHOTS;
  if (shots) await visitor.screenshot({ path: `${shots}/listings-search.png`, fullPage: true });
  await visitor.getByRole("link", { name: new RegExp(`Bright 2-bedroom in Westlands ${unique}`) }).click();
  await expect(visitor.getByRole("heading", { name: `Bright 2-bedroom in Westlands ${unique}` })).toBeVisible();
  await expect(visitor.getByRole("definition").filter({ hasText: "Ksh 45,000 / month" })).toBeVisible();
  await expect(visitor.getByRole("img", { name: /photo 1 of 1/ })).toBeVisible();
  await visitor.getByLabel("Your name").fill("Amina Yusuf");
  await visitor.getByLabel("Phone").fill("0722 333 444");
  await visitor.getByLabel("Anything else? (optional)").fill("After 5pm please");
  if (shots) await visitor.screenshot({ path: `${shots}/listing-detail.png`, fullPage: true });
  await visitor.getByRole("button", { name: "Request a viewing" }).click();
  await expect(visitor.getByText("Viewing request sent")).toBeVisible();
  await expect(visitor.getByText(/ENQ-0001/)).toBeVisible();
  await visitorContext.close();

  // --- Staff follow it up ------------------------------------------------------------------------
  await page.getByRole("tab", { name: "Enquiries & viewings" }).click();
  await page.getByRole("link", { name: "Amina Yusuf" }).click();
  await expect(page.getByRole("heading", { name: "Amina Yusuf" })).toBeVisible();
  await expect(page.getByText("After 5pm please")).toBeVisible();
  await page.getByRole("button", { name: "I've contacted them" }).click();
  await app.reports.expectToast("Marked as contacted");
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("Book a viewing").fill(`${tomorrow}T17:30`);
  await page.getByRole("button", { name: "Save viewing" }).click();
  await app.reports.expectToast("Viewing booked");
  await expect(page.getByText("Viewing booked", { exact: true }).first()).toBeVisible();
  await page.getByLabel("Close with outcome").selectOption({ label: "Took the unit" });
  await page.getByRole("button", { name: "Close enquiry" }).click();
  await app.reports.expectToast("Enquiry closed");
  await expect(page.getByText("Closed: Took the unit")).toBeVisible();
  await app.reports.snap("enquiry-closed");
});
