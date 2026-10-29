import { expect, test, type Download } from "@playwright/test";

import { BasePage } from "./base-page";

/** Dashboard → Reports: pick a report and period, read the figures, download files. */
export class ReportsPage extends BasePage {
  async open(): Promise<void> {
    await this.openFromSidebar("Reports");
    await expect(this.heading("Reports").first()).toBeVisible();
  }

  async choose(report: string): Promise<void> {
    await this.page.getByRole("tab", { name: report, exact: true }).click();
    await expect(this.heading(new RegExp(`^${report} ·`))).toBeVisible();
  }

  async setPeriod(preset: string, range?: { from: string; to: string }): Promise<void> {
    await this.field("Period").selectOption({ label: preset });
    if (range) {
      await this.field("From").fill(range.from);
      await this.field("To").fill(range.to);
    }
  }

  /** The value shown on a summary card, e.g. "Net billed". */
  summary(label: string) {
    return this.page.locator("p", { hasText: new RegExp(`^${label}$`) }).filter({ visible: true }).locator("xpath=following-sibling::p[1]");
  }

  async download(format: "PDF" | "Excel" | "CSV"): Promise<Download> {
    return test.step(`Download ${format}`, async () => {
      const [download] = await Promise.all([this.page.waitForEvent("download"), this.button(format, true).click()]);
      return download;
    });
  }
}
