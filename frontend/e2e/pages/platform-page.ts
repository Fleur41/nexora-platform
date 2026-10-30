import { expect, test } from "@playwright/test";

import { BasePage } from "./base-page";

/** Nexora's own console at /platform: organizations, their subscription, invoices, support access. */
export class PlatformPage extends BasePage {
  async signIn(email: string, password: string): Promise<void> {
    await test.step(`Sign in to the platform console as ${email}`, async () => {
      await this.page.goto("/login");
      await this.field("Email").fill(email);
      await this.field("Password").fill(password);
      await this.button("Sign in").click();
      await this.page.waitForURL((url) => url.pathname !== "/login");
      await this.page.goto("/platform");
      await expect(this.heading("Organizations")).toBeVisible();
    });
  }

  async openOrganization(name: string): Promise<void> {
    await this.page.goto("/platform");
    await this.field("Search organizations").fill(name);
    await this.link(name, true).click();
    await expect(this.heading(name)).toBeVisible();
  }

  async issueInvoice(): Promise<string> {
    await this.button("Issue invoice").click();
    const toast = this.page.getByText(/^NXI-\d+ issued$/);
    await expect(toast).toBeVisible();
    return (await toast.textContent())!.replace(" issued", "");
  }

  async recordPayment(invoice: string, method: string, reference: string): Promise<void> {
    await this.page.getByRole("row", { name: new RegExp(invoice) }).filter({ visible: true }).getByRole("button", { name: "Record payment" }).click();
    await this.dialog.getByLabel("Paid by").selectOption({ label: method });
    await this.dialog.getByLabel(/Reference/).fill(reference);
    await this.dialog.getByRole("button", { name: "Mark paid" }).click();
    await expect(this.page.getByRole("row", { name: new RegExp(invoice) }).filter({ visible: true })).toContainText("Paid");
  }

  async startSupport(reason: string, duration = "30 minutes"): Promise<void> {
    await this.field("Reason (shown to the owners)").fill(reason);
    await this.field("For", true).selectOption({ label: duration });
    await this.button("Start support session").click();
    await expect(this.text(/Your support session ends at/)).toBeVisible();
  }
}
