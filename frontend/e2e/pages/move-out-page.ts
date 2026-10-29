import { expect, test, type Locator } from "@playwright/test";

import { BasePage } from "./base-page";

/** Move-out notices: acknowledge, schedule the inspection, settle and close. */
export class MoveOutPage extends BasePage {
  async open(tenantName: string): Promise<void> {
    await this.openFromSidebar("Move-outs");
    await this.link(tenantName).click();
    await expect(this.heading(tenantName)).toBeVisible();
  }

  async acknowledge(staffNotes: string): Promise<void> {
    await test.step("Acknowledge the notice", async () => {
      await expect(this.text("New notice", true)).toBeVisible();
      await this.button("Acknowledge").click();
      await this.field("Staff notes (optional)").fill(staffNotes);
      await this.dialog.getByRole("button", { name: "Acknowledge" }).click();
      await this.expectToast("Notice acknowledged");
    });
  }

  async scheduleInspection(date: string): Promise<void> {
    await test.step(`Schedule move-out inspection on ${date}`, async () => {
      await this.button("Schedule inspection").click();
      await this.field("Date").fill(date);
      await this.dialog.getByRole("button", { name: "Schedule" }).click();
      await this.expectToast("Inspection scheduled");
    });
  }

  async openInspection(): Promise<void> {
    await this.link(/^INS-\d+$/).click();
    await expect(this.heading("Move-out inspection")).toBeVisible();
  }

  /** The settlement preview row for a label, e.g. “Refund to tenant”. */
  settlementRow(label: string): Locator {
    return this.page.locator("dl").filter({ visible: true }).getByText(label, { exact: true }).locator("..");
  }

  async expectSettlement(rows: Record<string, string>): Promise<void> {
    for (const [label, amount] of Object.entries(rows)) {
      await expect(this.settlementRow(label)).toContainText(amount);
    }
  }

  async complete(settlement: { unitStatus: string; refundMethod?: string; refundReference?: string; notes?: string }): Promise<void> {
    await test.step("Complete the move-out", async () => {
      await this.field(/^Unit .* becomes$/).selectOption({ label: settlement.unitStatus });
      if (settlement.refundMethod) await this.field("Refund paid by").selectOption({ label: settlement.refundMethod });
      if (settlement.refundReference) await this.field("Refund reference (optional)").fill(settlement.refundReference);
      if (settlement.notes) await this.field("Notes (optional)").fill(settlement.notes);
      await this.button("Complete move-out").click();
      await this.confirmDialog.getByRole("button", { name: "Complete move-out" }).click();
      await this.expectToast("Move-out completed");
      await expect(this.text("Final settlement")).toBeVisible();
    });
  }
}
