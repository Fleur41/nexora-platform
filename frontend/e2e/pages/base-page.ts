import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Shared helpers for every page object.
 *
 * Locators only match visible elements: with Cache Components, Next keeps recently visited
 * routes mounted but hidden (React <Activity>), so plain locators can also match the
 * previous page.
 */
export class BasePage {
  constructor(readonly page: Page) {}

  text(value: string | RegExp, exact = false): Locator {
    return this.page.getByText(value, { exact }).filter({ visible: true });
  }

  field(label: string | RegExp, exact = false): Locator {
    return this.page.getByLabel(label, { exact }).filter({ visible: true });
  }

  button(name: string | RegExp, exact = false): Locator {
    return this.page.getByRole("button", { name, exact }).filter({ visible: true });
  }

  link(name: string | RegExp, exact = false): Locator {
    return this.page.getByRole("link", { name, exact }).filter({ visible: true });
  }

  heading(name: string | RegExp): Locator {
    return this.page.getByRole("heading", { name }).filter({ visible: true });
  }

  get dialog(): Locator {
    return this.page.getByRole("dialog");
  }

  /** Confirmation dialogs (ConfirmDialog) use the alertdialog role. */
  get confirmDialog(): Locator {
    return this.page.getByRole("alertdialog");
  }

  /** Sonner toasts render in a labelled region; scoping avoids matching page text. */
  async expectToast(message: string | RegExp): Promise<void> {
    await expect(this.page.getByRole("region", { name: /Notifications/ }).getByText(message)).toBeVisible();
  }

  /** Navigate with the sidebar, the way a user would. */
  async openFromSidebar(label: string): Promise<void> {
    const link = this.page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: label, exact: true });
    const href = (await link.getAttribute("href"))!;
    await link.click();
    // Wait for the route: until then the previous page is still on screen and its links clickable.
    await this.page.waitForURL((url) => url.pathname === href);
  }

  /** Save a full-page screenshot when E2E_SCREENSHOTS=<dir> is set. */
  async snap(name: string): Promise<void> {
    const dir = process.env.E2E_SCREENSHOTS;
    if (dir) await this.page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
  }
}
