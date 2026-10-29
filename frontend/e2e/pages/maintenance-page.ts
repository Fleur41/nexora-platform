import { expect, test } from "@playwright/test";

import { BasePage } from "./base-page";

export interface MaintenanceInput {
  property: string;
  unit: string;
  category: string;
  urgency: string;
  title: string;
  details: string;
}

export class MaintenancePage extends BasePage {
  async createRequest(request: MaintenanceInput): Promise<void> {
    await test.step(`Report “${request.title}”`, async () => {
      await this.openFromSidebar("Maintenance");
      await this.button("New request").click();
      // Scoped to the dialog: the list page has its own Urgency filter.
      const form = this.dialog;
      await form.getByLabel("Property").selectOption({ label: request.property });
      await form.getByLabel("Unit", { exact: true }).selectOption({ label: request.unit });
      await form.getByLabel("Category").selectOption({ label: request.category });
      await form.getByLabel("Urgency").selectOption({ label: request.urgency });
      await form.getByLabel("What's wrong?").fill(request.title);
      await form.getByLabel("Details").fill(request.details);
      await this.button("Create request").click();
      await this.expectToast(/MNT-\d+ created/);
    });
  }

  async open(title: string): Promise<void> {
    await this.openFromSidebar("Maintenance");
    await this.link(title).click();
    await expect(this.heading(title)).toBeVisible();
  }

  async addUpdate(body: string, internal = false): Promise<void> {
    await test.step(`Add ${internal ? "internal note" : "tenant update"}`, async () => {
      await this.field("Internal note (never shown to the tenant)").setChecked(internal);
      await this.field("Add an update").fill(body);
      await this.button("Add update").click();
      await this.expectToast(internal ? "Internal note added" : "Update sent to the tenant");
      await expect(this.text(body)).toBeVisible();
    });
  }

  async assignToMe(visitDate: string): Promise<void> {
    await test.step(`Assign and schedule a visit on ${visitDate}`, async () => {
      const assignee = this.field("Assign to");
      if (await assignee.count()) await assignee.selectOption({ index: 1 });
      await this.field("Visit date (optional)").fill(visitDate);
      await this.button("Save assignment").click();
      await this.expectToast("Assignment saved");
    });
  }

  async addCost(cost: { kind: "Quotation" | "Cost incurred"; description: string; amount: string; supplier?: string }): Promise<void> {
    await test.step(`Add ${cost.kind.toLowerCase()} ${cost.amount}`, async () => {
      await this.field("Cost type").selectOption({ label: cost.kind });
      await this.field("Amount", true).fill(cost.amount);
      await this.field("Cost description").fill(cost.description);
      if (cost.supplier) await this.field("Supplier").fill(cost.supplier);
      await this.button("Add", true).click();
      await expect(this.text(cost.description)).toBeVisible();
    });
  }

  async approveQuote(): Promise<void> {
    await this.button("Approve", true).click();
    await this.expectToast("Quote approved");
  }

  /** Click a status button (Acknowledge, Start work, Mark resolved, Close…) and check the badge. */
  async moveTo(action: string, status: string): Promise<void> {
    await test.step(`${action} → ${status}`, async () => {
      await this.button(action, true).click();
      await this.expectToast(`Marked ${status.toLowerCase()}`);
      await expect(this.text(status, true).first()).toBeVisible();
    });
  }
}
