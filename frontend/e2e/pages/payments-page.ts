import { expect, test } from "@playwright/test";

import { BasePage } from "./base-page";

/** Payment settings, payments list and receipts. */
export class PaymentsPage extends BasePage {
  async addPaybill(name: string, paybill: string): Promise<void> {
    await test.step(`Add paybill ${paybill}`, async () => {
      await this.page.goto("/dashboard/settings/payments");
      await this.button("Add payment method").first().click();
      await this.field("Name", true).fill(name);
      await this.field("Paybill number").fill(paybill);
      await this.button("Save", true).click();
      await expect(this.text(paybill)).toBeVisible();
    });
  }

  async openReceipt(receipt: string): Promise<void> {
    await test.step(`Open receipt ${receipt}`, async () => {
      await this.openFromSidebar("Payments");
      await this.link(receipt).click();
      await expect(this.heading(receipt)).toBeVisible();
      await this.link("Receipt").click();
      await expect(this.text("RECEIPT", true)).toBeVisible();
    });
  }
}
