import * as data from "../support/data";
import { expect, test } from "../support/fixtures";

/**
 * Full regression journey, start to finish, entirely through the UI:
 * sign-up → property → tenant → lease → charges and billing → deposit and payment →
 * announcement → maintenance → move-out notice → inspection → settlement → unit released.
 *
 * Each stage depends on the one before, so it is one test with named steps (the report
 * shows exactly which stage failed). Amounts used throughout:
 *   rent 22,000 + security 1,500 = 23,500 a month, billed for 2 months = 47,000
 *   deposit 22,000 held; cash payment 30,000 → balance 17,000
 *   damages 3,000 → 19,000 left; 17,000 clears the balance; 2,000 refunded
 */
test.describe("Regression: full property lifecycle", () => {
  test("owner runs a tenancy from sign-up to move-out settlement", async ({ app, page }) => {
    let leaseUrl = "";
    const unit = `${data.unitPrefix}1`;

    await test.step("1. Sign up and create the organization", async () => {
      await app.auth.register(data.owner);
      await app.auth.createOrganization(data.organization);
    });

    await test.step("2. Property, unit type and units", async () => {
      await app.properties.createProperty(data.property);
      await app.properties.addUnitType(data.unitType);
      await app.properties.addUnits(data.unitPrefix, 4);
      await app.properties.snap("regression-property");
    });

    await test.step("3. Tenant and lease", async () => {
      await app.tenants.registerTenant(data.tenant);
      leaseUrl = await app.lease.createFromTenant({
        property: data.property.name,
        startDate: `${data.month(-1)}-01`,
        rent: data.unitType.rent,
        deposit: data.unitType.deposit,
      });
      await app.properties.open(data.property.name);
      await expect(app.properties.unitTile(unit, "Occupied")).toBeVisible();
    });

    await test.step("4. Charges and two months of billing", async () => {
      await app.billing.addChargeRule({ ...data.security, effectiveFrom: `${data.month(-1)}-01` });
      await app.billing.generateInvoices(data.month(-1), "23,500");
      await app.billing.generateInvoices(data.month(0), "23,500");
      await app.billing.expectInvoiceCount(2);
      await app.lease.open(leaseUrl);
      await app.lease.expectBalance("47,000");
    });

    await test.step("5. Deposit and a cash payment with receipt", async () => {
      await app.lease.recordDepositReceived(data.unitType.deposit, "DEP-QA-001");
      const receipt = await app.lease.recordPayment({ amount: "30000", method: "Cash" });
      await app.lease.expectBalance("17,000");
      await app.payments.openReceipt(receipt);
      await expect(app.payments.text(data.tenant.name)).toBeVisible();
      await expect(app.payments.text(/Account balance now:\s*Ksh\s17,000/)).toBeVisible();
    });

    await test.step("6. Announcement and reminder settings", async () => {
      await app.communications.open();
      await app.communications.sendAnnouncement(
        { title: "Water interruption on Saturday", body: "Supply is off from 8am to 2pm for tank cleaning." },
        "1 tenant",
      );
      await app.communications.expectDelivered("Water interruption on Saturday");
      await app.communications.setRentDueReminder(5);
    });

    await test.step("7. Maintenance request from report to close", async () => {
      const title = "Kitchen sink leaking";
      await app.maintenance.createRequest({
        property: data.property.name,
        unit,
        category: "Plumbing",
        urgency: "High",
        title,
        details: "Water pooling under the sink since last night.",
      });
      await app.maintenance.open(title);
      await app.maintenance.moveTo("Acknowledge", "Acknowledged");
      await app.maintenance.assignToMe(data.today);
      await app.maintenance.addCost({ kind: "Quotation", description: "Replace trap and seal", amount: "2500", supplier: "Westlands Plumbers" });
      await app.maintenance.approveQuote();
      await app.maintenance.moveTo("Start work", "In progress");
      await app.maintenance.addUpdate("Plumber visited, waiting for a part.", true);
      await app.maintenance.addUpdate("Fixed. Please report if it leaks again.");
      await app.maintenance.moveTo("Mark resolved", "Resolved");
      await app.maintenance.moveTo("Close", "Closed");
    });

    await test.step("8. Move-out notice and acknowledgement", async () => {
      await app.lease.open(leaseUrl);
      await app.lease.recordMoveOutNotice(data.today, "Relocating to Nakuru for work.");
      await app.moveOut.open(data.tenant.name);
      await app.moveOut.acknowledge("Confirmed by phone.");
      await app.properties.open(data.property.name);
      await expect(app.properties.unitTile(unit, "Notice submitted")).toBeVisible();
    });

    await test.step("9. Move-out inspection with a damage charge", async () => {
      await app.moveOut.open(data.tenant.name);
      await app.moveOut.scheduleInspection(data.today);
      await app.moveOut.openInspection();
      await app.inspection.addItem("Balcony", "Railing");
      await app.inspection.fillChecklist("Good", [
        { item: "Windows", condition: "Damaged", notes: "Bedroom window pane cracked", charge: "3000" },
      ]);
      await app.inspection.expectDamages("3,000");
      await app.inspection.complete({ inspector: data.owner.name, keys: 2, tenant: data.tenant.name, summary: "Clean overall." });
      await app.inspection.snap("regression-inspection");
    });

    await test.step("10. Settlement and closing the tenancy", async () => {
      await app.moveOut.open(data.tenant.name);
      await app.moveOut.expectSettlement({
        "Deposit held": "22,000",
        "Damages deducted": "3,000",
        "Balance owed before settlement": "17,000",
        "Deposit applied to balance": "17,000",
        "Refund to tenant": "2,000",
        "Balance still owed after": "0",
      });
      await app.moveOut.complete({ unitStatus: "Available", refundMethod: "M-Pesa", refundReference: "QA2000REF", notes: "Keys handed over." });
      await app.moveOut.snap("regression-settlement");
    });

    await test.step("11. Lease ended and unit back on the market", async () => {
      await app.lease.open(leaseUrl);
      await app.lease.expectStatus("Ended");
      await app.lease.expectBalance("0");
      await app.properties.open(data.property.name);
      await expect(app.properties.unitTile(unit, "Available")).toBeVisible();
    });

    await expect(page).toHaveURL(/\/dashboard\/properties\//);
  });
});
