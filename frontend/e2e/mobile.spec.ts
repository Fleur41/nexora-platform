import { expect, test } from "@playwright/test";

test("public landing and auth pages work at phone width", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Run your whole business/ })).toBeVisible();
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const width = await page.evaluate(() => window.innerWidth);
  expect(scrollWidth).toBeLessThanOrEqual(width); // no horizontal scroll
  await page.getByRole("link", { name: "Sign in" }).first().click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  expect(errors).toEqual([]);
});
