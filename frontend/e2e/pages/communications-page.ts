import { expect, test } from "@playwright/test";

import { BasePage } from "./base-page";

export class CommunicationsPage extends BasePage {
  async open(): Promise<void> {
    await this.openFromSidebar("Communications");
    await expect(this.heading("Communications")).toBeVisible();
  }

  async sendAnnouncement(a: { title: string; body: string; property?: string; sms?: boolean }, expectedRecipients: string): Promise<void> {
    await test.step(`Announce “${a.title}”`, async () => {
      await this.page.getByRole("tab", { name: "Announcements" }).click();
      if (a.property) await this.field("Send to").selectOption({ label: a.property });
      await this.field("Title").fill(a.title);
      await this.field("Message").fill(a.body);
      if (a.sms) await this.field("SMS", true).check();
      await this.button("Send", true).click();
      await this.confirmDialog.getByRole("button", { name: "Send now" }).click();
      await this.expectToast(`Sent to ${expectedRecipients}`);
      await expect(this.text(a.title, true)).toBeVisible();
    });
  }

  async setRentDueReminder(days: number): Promise<void> {
    await test.step(`Rent due reminder ${days} days before`, async () => {
      await this.page.getByRole("tab", { name: "Reminders & channels" }).click();
      await this.field("Rent due reminder").fill(String(days));
      await this.button("Save settings").click();
      await this.expectToast("Settings saved");
    });
  }

  async expectDelivered(title: string): Promise<void> {
    await this.page.getByRole("tab", { name: "Delivery log" }).click();
    await expect(this.page.getByRole("row", { name: new RegExp(title) }).first()).toBeVisible();
  }
}
