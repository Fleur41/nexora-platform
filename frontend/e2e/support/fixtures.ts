import { devices, expect, test as base, type Page } from "@playwright/test";

import {
  AuthPage,
  BillingPage,
  CommunicationsPage,
  InspectionPage,
  LeasePage,
  MaintenancePage,
  MoveOutPage,
  PaymentsPage,
  PortalPage,
  PropertiesPage,
  ReportsPage,
  TenantsPage,
} from "../pages";

/** Every page object, sharing the test's page. */
export interface App {
  auth: AuthPage;
  properties: PropertiesPage;
  tenants: TenantsPage;
  lease: LeasePage;
  billing: BillingPage;
  payments: PaymentsPage;
  maintenance: MaintenancePage;
  moveOut: MoveOutPage;
  inspection: InspectionPage;
  communications: CommunicationsPage;
  portal: PortalPage;
  reports: ReportsPage;
}

/** Collect uncaught browser errors (hydration, runtime exceptions) on a page. */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

// The tenant uses the app on a phone. Browser type comes from the project, not the device.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { defaultBrowserType, ...phone } = devices["Pixel 7"];

export const test = base.extend<{ app: App; tenantApp: PortalPage; failOnPageErrors: void }>({
  app: async ({ page }, provide) => {
    await provide({
      auth: new AuthPage(page),
      properties: new PropertiesPage(page),
      tenants: new TenantsPage(page),
      lease: new LeasePage(page),
      billing: new BillingPage(page),
      payments: new PaymentsPage(page),
      maintenance: new MaintenancePage(page),
      moveOut: new MoveOutPage(page),
      inspection: new InspectionPage(page),
      communications: new CommunicationsPage(page),
      portal: new PortalPage(page),
      reports: new ReportsPage(page),
    });
  },
  /**
   * A second, phone-sized browser with its own session: the tenant's phone, next to the staff
   * browser. Created only for tests that use it.
   */
  tenantApp: async ({ browser, baseURL }, provide) => {
    const context = await browser.newContext({ ...phone, baseURL });
    const page = await context.newPage();
    const errors = trackErrors(page);
    await provide(new PortalPage(page));
    await context.close();
    expect(errors, "uncaught browser errors in the tenant app").toEqual([]);
  },
  // Any uncaught browser error fails the test.
  failOnPageErrors: [
    async ({ page }, provide) => {
      const errors = trackErrors(page);
      await provide();
      expect(errors, "uncaught browser errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
