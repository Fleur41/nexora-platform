import { expect, test } from "@playwright/test";

import { BasePage } from "./base-page";

/** The tenant app (/portal): what a tenant sees on their phone. */
export class PortalPage extends BasePage {
  /** Open the invitation link, create the tenant's account and connect their home. */
  async joinFromInvitation(link: string, tenant: { name: string; password: string }): Promise<void> {
    await test.step(`${tenant.name} joins from the invitation email`, async () => {
      await this.page.goto(new URL(link).pathname);
      await expect(this.heading(/^Your home with/)).toBeVisible();
      await this.link("Create account").click();
      await this.field("Full name").fill(tenant.name);
      await this.field("Password").fill(tenant.password);
      await this.button("Create account").click();
      await expect(this.heading(/^Your home with/)).toBeVisible();
      await this.button("Open my home").click();
      await this.page.waitForURL((url) => url.pathname === "/portal");
      await expect(this.heading(`Hi ${tenant.name.split(" ")[0]}`)).toBeVisible();
    });
  }

  /** Bottom tab bar on phones, top links on larger screens. */
  async openTab(label: "Home" | "Bills" | "Pay" | "Repairs" | "Move out"): Promise<void> {
    const nav = this.page.getByRole("navigation", { name: /^Portal/ }).filter({ visible: true });
    const link = nav.getByRole("link", { name: label, exact: true });
    const href = (await link.getAttribute("href"))!;
    await link.click();
    await this.page.waitForURL((url) => url.pathname === href);
  }

  async expectBalance(amount: string): Promise<void> {
    await expect(this.page.getByTestId("portal-balance").filter({ visible: true })).toContainText(amount);
  }

  async openBill(number: string): Promise<void> {
    await this.openTab("Bills");
    await this.link(new RegExp(number)).click();
    await expect(this.text(number).first()).toBeVisible();
  }

  async openReceipt(receipt: string): Promise<void> {
    await this.openTab("Bills");
    await this.page.getByRole("tab", { name: "Receipts" }).click();
    await this.link(new RegExp(receipt)).click();
    await expect(this.text("RECEIPT", true)).toBeVisible();
  }

  async reportRepair(repair: { category: string; urgency: string; title: string; details: string; photo?: { name: string; buffer: Buffer } }): Promise<void> {
    await test.step(`Tenant reports “${repair.title}”`, async () => {
      await this.openTab("Repairs");
      await this.button("Report a repair").click();
      await this.field("What kind?").selectOption({ label: repair.category });
      await this.field("How urgent?").selectOption({ label: repair.urgency });
      await this.field("What's wrong?").fill(repair.title);
      await this.field("Details").fill(repair.details);
      if (repair.photo) {
        await this.page.getByLabel("Add photos").setInputFiles({ name: repair.photo.name, mimeType: "image/png", buffer: repair.photo.buffer });
        await expect(this.page.getByRole("img", { name: "Photo 1" })).toBeVisible();
      }
      await this.button("Send report").click();
      await this.expectToast(/MNT-\d+ sent to your landlord/);
      await expect(this.heading(repair.title)).toBeVisible();
    });
  }

  async messageLandlord(body: string): Promise<void> {
    await this.field("Message your landlord").fill(body);
    await this.button("Send", true).click();
    await this.expectToast("Message sent");
    await expect(this.text(body)).toBeVisible();
  }

  async giveNotice(date: string, message: string): Promise<void> {
    await test.step(`Tenant gives notice for ${date}`, async () => {
      await this.openTab("Move out");
      await this.field("Date you plan to move out").fill(date);
      await this.field("Message (optional)").fill(message);
      await this.button("Send notice").click();
      await this.confirmDialog.getByRole("button", { name: "Send notice" }).click();
      await this.expectToast("Notice sent to your landlord");
      await expect(this.text("Notice sent", true)).toBeVisible();
    });
  }
}
