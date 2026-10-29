import { expect, test } from "@playwright/test";

import { BasePage } from "./base-page";

/** Charge rules and monthly billing runs. */
export class BillingPage extends BasePage {
  async addChargeRule(rule: { charge: string; amount: string; effectiveFrom: string }): Promise<void> {
    await test.step(`Add ${rule.charge} charge of ${rule.amount}`, async () => {
      await this.openFromSidebar("Charges");
      await this.button("Add rule").first().click();
      await this.field("Charge", true).selectOption({ label: rule.charge });
      await this.field(/^Amount/).fill(rule.amount);
      await this.field("Effective from").fill(rule.effectiveFrom);
      await this.button("Save rule").click();
      await expect(this.page.getByRole("row", { name: new RegExp(`${rule.charge}.*All properties`) })).toBeVisible();
    });
  }

  /** Preview and post a billing run for a month (YYYY-MM); checks the preview total. */
  async generateInvoices(month: string, expectedTotal: string): Promise<void> {
    await test.step(`Bill ${month} (${expectedTotal})`, async () => {
      await this.openFromSidebar("Billing");
      await this.button("Generate invoices").click();
      await this.field("Month").fill(month);
      await this.button("Preview").click();
      await expect(this.dialog.getByText(/invoices? totalling/)).toContainText(expectedTotal);
      await this.button("Post invoices").click();
      await expect(this.dialog).toBeHidden();
    });
  }

  async expectInvoiceCount(count: number): Promise<void> {
    await expect(this.link(/^INV-\d+$/)).toHaveCount(count);
  }
}
