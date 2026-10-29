import { expect, test as base } from "@playwright/test";

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
}

export const test = base.extend<{ app: App; failOnPageErrors: void }>({
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
    });
  },
  // Any uncaught browser error (hydration, runtime exception) fails the test.
  failOnPageErrors: [
    async ({ page }, provide) => {
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));
      await provide();
      expect(errors, "uncaught browser errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
