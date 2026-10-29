import { expect, test } from "@playwright/test";

import { BasePage } from "./base-page";

export interface Finding {
  item: string;
  condition: string;
  notes?: string;
  charge?: string;
}

/** Inspection detail: checklist, completion and signatures. */
export class InspectionPage extends BasePage {
  /** Mark every unchecked item with one condition, then record specific findings. */
  async fillChecklist(defaultCondition: string, findings: Finding[]): Promise<void> {
    await test.step(`Check every item (${findings.length} findings)`, async () => {
      const selects = this.page.getByRole("combobox", { name: / condition$/ }).filter({ visible: true });
      const count = await selects.count();
      for (let i = 0; i < count; i++) await selects.nth(i).selectOption({ label: defaultCondition });
      for (const f of findings) {
        await this.field(`${f.item} condition`, true).first().selectOption({ label: f.condition });
        if (f.notes) await this.field(`${f.item} notes`, true).first().fill(f.notes);
        if (f.charge) await this.field(`${f.item} charge`, true).first().fill(f.charge);
      }
      await this.button("Save checklist").click();
      await this.expectToast("Checklist saved");
      await expect(this.text("Every item has been checked.")).toBeVisible();
    });
  }

  async addItem(area: string, name: string): Promise<void> {
    await test.step(`Add checklist item ${area} / ${name}`, async () => {
      await this.field("New item area").fill(area);
      await this.field("New item name").fill(name);
      await this.button("Add item").click();
      await this.expectToast("Item added");
    });
  }

  async complete(signoff: { inspector: string; keys?: number; tenant?: string; summary?: string }): Promise<void> {
    await test.step(`Complete inspection signed by ${signoff.inspector}`, async () => {
      await this.button("Complete", true).click();
      if (signoff.summary) await this.field("Summary (optional)").fill(signoff.summary);
      if (signoff.keys !== undefined) await this.field("Keys returned (optional)").fill(String(signoff.keys));
      if (signoff.tenant) {
        await this.field("Tenant was present").check();
        await this.field("Tenant signature (optional)").fill(signoff.tenant);
      }
      await this.field("Inspector signature").fill(signoff.inspector);
      await this.dialog.getByRole("button", { name: "Complete inspection" }).click();
      await this.expectToast("Inspection completed");
      await expect(this.text(`Signed by inspector: ${signoff.inspector}`)).toBeVisible();
    });
  }

  async expectDamages(amount: string): Promise<void> {
    await expect(this.text(/^Damage charges:/)).toContainText(amount);
  }
}
