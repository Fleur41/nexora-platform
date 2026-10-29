import { expect, test } from "@playwright/test";

import { BasePage } from "./base-page";

export interface TenantInput {
  name: string;
  phone: string;
  idNumber: string;
  email?: string;
}

export class TenantsPage extends BasePage {
  async registerTenant(tenant: TenantInput): Promise<void> {
    await test.step(`Register tenant ${tenant.name}`, async () => {
      await this.openFromSidebar("Tenants");
      await this.button("Register tenant").first().click();
      await this.field("Full name").fill(tenant.name);
      await this.field("Phone", true).fill(tenant.phone);
      if (tenant.email) await this.field("Email (optional)").fill(tenant.email);
      await this.field("ID number").fill(tenant.idNumber);
      await this.button("Register tenant").last().click();
      await expect(this.heading(tenant.name)).toBeVisible();
    });
  }

  async open(name: string): Promise<void> {
    await this.openFromSidebar("Tenants");
    await this.link(name).click();
    await expect(this.heading(name)).toBeVisible();
  }

  /** On the tenant's page: send the tenant app invitation to their email. */
  async inviteToApp(): Promise<void> {
    await test.step("Invite the tenant to the tenant app", async () => {
      await expect(this.text("Not invited", true)).toBeVisible();
      await this.button("Send invitation").click();
      await this.expectToast(/Invitation sent to/);
      await expect(this.text("Invited", true)).toBeVisible();
    });
  }
}
