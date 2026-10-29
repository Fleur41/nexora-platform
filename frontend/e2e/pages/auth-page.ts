import { expect, test } from "@playwright/test";

import { BasePage } from "./base-page";

export interface Account {
  name: string;
  email: string;
  password: string;
}

export class AuthPage extends BasePage {
  async register(account: Account): Promise<void> {
    await test.step(`Register ${account.email}`, async () => {
      await this.page.goto("/register");
      await this.field("Full name").fill(account.name);
      await this.field("Work email").fill(account.email);
      await this.field("Password").fill(account.password);
      await this.button("Create account").click();
      await expect(this.page).toHaveURL(/\/onboarding/);
    });
  }

  async createOrganization(name: string): Promise<void> {
    await test.step(`Create organization ${name}`, async () => {
      await this.field("Organization name").fill(name);
      await this.button("Create organization").click();
      await expect(this.page).toHaveURL(/\/dashboard$/);
      await expect(this.heading(name)).toBeVisible();
    });
  }

  async signOut(): Promise<void> {
    await test.step("Sign out", async () => {
      await this.button("Open account menu").click();
      await this.page.getByRole("menuitem", { name: "Sign out" }).click();
      await expect(this.page).toHaveURL(/\/login/);
    });
  }

  async signIn(account: Pick<Account, "email" | "password">): Promise<void> {
    await test.step(`Sign in as ${account.email}`, async () => {
      await this.page.goto("/login");
      await this.field("Email").fill(account.email);
      await this.field("Password").fill(account.password);
      await this.button("Sign in").click();
      await expect(this.page).toHaveURL(/\/dashboard$/);
    });
  }
}
