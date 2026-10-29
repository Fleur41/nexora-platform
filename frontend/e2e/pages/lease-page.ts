import { expect, test } from "@playwright/test";

import { BasePage } from "./base-page";

export interface LeaseInput {
  property: string;
  startDate: string;
  rent: string;
  deposit: string;
}

/** New lease form and the lease detail page (account, deposit, payments, notice). */
export class LeasePage extends BasePage {
  /** From a tenant's page: “New lease” → first available unit in the property. Returns the lease URL. */
  async createFromTenant(lease: LeaseInput): Promise<string> {
    return test.step(`Let a unit in ${lease.property} from ${lease.startDate}`, async () => {
      await this.link("New lease").click();
      await expect(this.heading("New lease")).toBeVisible();
      await expect(this.field("Tenant", true)).toHaveValue(/.+/);
      const property = this.field("Property");
      const option = await property.locator("option", { hasText: lease.property }).textContent();
      await property.selectOption({ label: option! });
      await this.field("Unit", true).selectOption({ index: 1 });
      await expect(this.field(/Monthly rent/)).toHaveValue(Number(lease.rent).toFixed(2));
      await expect(this.field(/Deposit/)).toHaveValue(Number(lease.deposit).toFixed(2));
      await this.field("Start date").fill(lease.startDate);
      await this.button("Create lease").click();
      await expect(this.heading(/^LSE-\d+$/)).toBeVisible();
      await expect(this.text("Active", true)).toBeVisible();
      return this.page.url();
    });
  }

  async open(url: string): Promise<void> {
    await this.page.goto(url);
    await expect(this.heading(/^LSE-\d+$/)).toBeVisible();
  }

  async reference(): Promise<string> {
    return (await this.heading(/^LSE-\d+$/).textContent())!.trim();
  }

  async recordDepositReceived(amount: string, reference: string): Promise<void> {
    await test.step(`Record deposit received ${amount}`, async () => {
      await this.button("Record received").click();
      await this.field(/^Amount/).fill(amount);
      await this.field(/Reference/).fill(reference);
      await this.button("Save", true).click();
      await expect(this.text(new RegExp(reference))).toBeVisible();
    });
  }

  /** Record a payment against this lease. Returns the receipt number from the toast. */
  async recordPayment(payment: { amount: string; method: string; reference?: string }): Promise<string> {
    return test.step(`Record ${payment.method} payment ${payment.amount}`, async () => {
      await this.button("Record payment").first().click();
      await this.field(/^Amount/).fill(payment.amount);
      await this.field("Paid via").selectOption({ label: payment.method });
      if (payment.reference) await this.field(/M-Pesa code|Bank reference|Reference/).fill(payment.reference);
      await this.dialog.getByRole("button", { name: "Record payment" }).click();
      const toast = this.page.getByRole("region", { name: /Notifications/ }).getByText(/Receipt RCT-\d+ issued/);
      await expect(toast).toBeVisible();
      return (await toast.textContent())!.match(/RCT-\d+/)![0];
    });
  }

  async expectBalance(amount: string): Promise<void> {
    await expect(this.text("Balance", true)).toBeVisible();
    await expect(this.page.locator("p", { hasText: new RegExp(`^Ksh\\s${amount}$`) }).filter({ visible: true }).first()).toBeVisible();
  }

  async recordMoveOutNotice(date: string, message: string): Promise<void> {
    await test.step(`Record move-out notice for ${date}`, async () => {
      await this.button("Record move-out notice").click();
      await this.field("Planned move-out date").fill(date);
      await this.field("Notes from the tenant (optional)").fill(message);
      await this.dialog.getByRole("button", { name: "Record notice" }).click();
      await this.expectToast("Move-out notice recorded");
    });
  }

  async expectStatus(status: string): Promise<void> {
    await expect(this.text(status, true).first()).toBeVisible();
  }
}
