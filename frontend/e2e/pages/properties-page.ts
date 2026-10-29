import { expect, test } from "@playwright/test";

import { BasePage } from "./base-page";

export interface PropertyInput {
  name: string;
  town: string;
  county: string;
}

export interface UnitTypeInput {
  category: string;
  rent: string;
  deposit: string;
}

export class PropertiesPage extends BasePage {
  async createProperty(property: PropertyInput): Promise<void> {
    await test.step(`Create property ${property.name}`, async () => {
      await this.openFromSidebar("Properties");
      await this.button("Add property").first().click();
      await this.field("Name", true).fill(property.name);
      await this.field("Town / area").fill(property.town);
      await this.field("County").fill(property.county);
      await this.button("Create property").click();
      await expect(this.heading(property.name)).toBeVisible();
    });
  }

  /** On the property page: add a unit type with default rent and deposit. */
  async addUnitType(unitType: UnitTypeInput): Promise<void> {
    await test.step(`Add unit type ${unitType.category}`, async () => {
      await this.page.getByRole("tab", { name: "Unit types" }).click();
      await this.button("Add unit type").click();
      await this.field("Category").selectOption(unitType.category);
      await this.field("Default monthly rent").fill(unitType.rent);
      await this.field("Default deposit").fill(unitType.deposit);
      await this.button("Save").click();
      await expect(this.dialog).toBeHidden();
    });
  }

  /** On the property page: create a numbered run of units (e.g. C1…C4). */
  async addUnits(prefix: string, count: number): Promise<void> {
    await test.step(`Add ${count} units ${prefix}1–${prefix}${count}`, async () => {
      await this.page.getByRole("tab", { name: "Units" }).click();
      await this.button("Add several").click();
      await this.field("Prefix").fill(prefix);
      await this.field("How many").fill(String(count));
      await this.button("Create units").click();
      await expect(this.unitTile(`${prefix}${count}`, "Available")).toBeVisible();
    });
  }

  async open(name: string): Promise<void> {
    await this.openFromSidebar("Properties");
    await this.link(name).click();
    await expect(this.heading(name)).toBeVisible();
  }

  unitTile(unit: string, status: string) {
    return this.button(`Unit ${unit}, ${status}`);
  }
}
