// Builds docs/manual/Nexora-User-Manual.pdf from the manual text below and the screenshots
// captured by capture.spec.ts. Run both with `npm run docs:manual` (needs the app, Django
// with Mailpit, and Mailpit running, as for the browser tests).

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";

const OUT = path.resolve(process.env.MANUAL_OUT ?? "../docs/manual");
const SCREENS = path.join(OUT, "screens");

// Dates match the screenshots, which are captured on the same day as the build.
const now = new Date();
const fmt = (d, opts) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", ...opts }).format(d);
const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const day = (d) => fmt(d, { day: "numeric", month: "short", year: "numeric" });
const START = day(lastMonth);
const M1 = fmt(lastMonth, { month: "long", year: "numeric" });
const M2 = fmt(thisMonth, { month: "long", year: "numeric" });
const TODAY = day(now);

const L = "landlord";
const T = "tenant";

/**
 * The manual. Each section has steps; a step has a role (landlord / tenant app), HTML text,
 * and optional screenshots (file names in screens/, without .jpg).
 */
const sections = [
  {
    title: "Sign up",
    intro: "The landlord creates an account and their organization. Everything else lives inside it.",
    steps: [
      { role: L, text: "Open <b>http://localhost:3000/register</b>. Enter your <b>Full name</b>, <b>Work email</b> and a <b>Password</b>, then click <b>Create account</b>.", shots: ["01-register"] },
      { role: L, text: "Enter your <b>Organization name</b> (e.g. <i>Riverside Lettings</i>) and click <b>Create organization</b>. Kenya, KES and the Nairobi time zone are the defaults.", shots: ["02-organization"] },
      { role: L, text: "You land on the dashboard. The sidebar lists everything you can manage; it shows only what your role is allowed to use.", shots: ["03-dashboard"] },
    ],
  },
  {
    title: "Property and units",
    intro: "A property holds unit types (the kinds of home, with their default rent and deposit) and the units themselves.",
    steps: [
      { role: L, text: "Sidebar <b>Properties → Add property</b>. Name <i>Riverside Apartments</i>, Town / area <i>Westlands</i>, County <i>Nairobi</i> → <b>Create property</b>.", shots: ["04-add-property"] },
      { role: L, text: "On the property page open the <b>Unit types</b> tab → <b>Add unit type</b>. Category <i>One bedroom</i>, Default monthly rent <i>22000</i>, Default deposit <i>22000</i> → <b>Save</b>.", shots: ["05-unit-type"] },
      { role: L, text: "Open the <b>Units</b> tab → <b>Add several</b>. Prefix <i>R</i>, How many <i>4</i>. The dialog previews the unit numbers → <b>Create units</b>.", shots: ["06-add-units"] },
      { role: L, text: "Units R1 to R4 appear in the grid, all <b>Available</b>. Click a unit to change its status by hand (e.g. under maintenance).", shots: ["07-units"] },
    ],
  },
  {
    title: "Tenant and lease",
    intro: "Register the tenant, then let a unit to them. The lease holds the rent, deposit, billing frequency and due day.",
    steps: [
      { role: L, text: "Sidebar <b>Tenants → Register tenant</b>. Full name <i>Wanjiku Kamau</i>, Phone <i>0722 456 789</i>, her <b>email</b> (needed for the tenant app), any ID number → <b>Register tenant</b>.", shots: ["08-register-tenant"] },
      { role: L, text: `On her page choose <b>New lease</b>. Property <i>Riverside Apartments</i>, Unit <i>R1</i>: rent and deposit fill in from the unit type. Set <b>Start date</b> to <b>${START}</b> → <b>Create lease</b>.`, shots: ["09-new-lease"] },
      { role: L, text: "The lease <b>LSE-0001</b> is <b>Active</b> and R1 is now <b>Occupied</b>. The lease page is the tenant's account: balance, bills, deposit and payments.", shots: ["10-lease-active"], note: "Moving in part-way through a month? See <b>Tenants moving in mid-month</b> at the end of this guide." },
    ],
  },
  {
    title: "The tenant joins the tenant app",
    intro: "Tenants get their own app for their bills, receipts, payments, repairs and moving out. They join from an email invitation.",
    steps: [
      { role: L, text: "On Wanjiku's page, the <b>Tenant app</b> card says <b>Not invited</b>. Check the email and click <b>Send invitation</b>. The badge changes to <b>Invited</b>.", shots: ["11-invite"] },
      { role: "email", text: "Open the inbox at <b>http://localhost:8025</b> and open <i>Your tenant account with Riverside Lettings</i>. Copy the link. (In production this goes to the tenant's real email; the link lasts 14 days.)", shots: ["12-invitation-email"] },
      { role: T, text: "In a <b>private window</b> (or on a phone), open the link. It shows who invited her → <b>Create account</b>.", shots: ["13-tenant-invitation"] },
      { role: T, text: "Enter her <b>Full name</b> and a <b>Password</b>; the email is filled in → <b>Create account</b>, then <b>Open my home</b>.", shots: ["14-tenant-signup"] },
      { role: T, text: "The tenant app: <i>Hi Wanjiku</i>, her home and a balance of 0. On a phone it offers to install itself (Android: <b>Install app</b>; iPhone: Share → <b>Add to Home Screen</b>).", shots: ["15-tenant-home"] },
      { role: L, text: "Refresh Wanjiku's page: the badge now says <b>Using the app</b>. From here you can also remove her access.", shots: ["16-using-the-app"] },
    ],
  },
  {
    title: "Payment method, charges and billing",
    intro: "Tell tenants how to pay, add extra charges, then bill each month. Billing previews everything before posting.",
    steps: [
      { role: L, text: "Sidebar <b>Payment settings → Add payment method</b>. Type <i>M-Pesa paybill</i>, Name <i>Rent paybill</i>, Paybill number <i>600987</i> → <b>Save</b>. Tenants see these details, with their own account number, in the app.", shots: ["17-paybill"] },
      { role: L, text: `Sidebar <b>Charges → Add rule</b>. Charge <i>Security</i>, Amount <i>1500</i>, Effective from <i>${START}</i> → <b>Save rule</b>. It applies to every unit unless you make an exception.`, shots: ["18-charge-rule"] },
      { role: L, text: `Sidebar <b>Billing → Generate invoices</b>. Month <b>${M1}</b> → <b>Preview</b>: <i>1 invoice totalling Ksh 23,500</i> (rent 22,000 + security 1,500) → <b>Post invoices</b>. Repeat for <b>${M2}</b>.`, shots: ["19-billing-preview"] },
      { role: L, text: "The billing list shows both invoices. Running a month again only bills what's new, so nothing is ever billed twice.", shots: ["20-invoices"] },
      { role: T, text: "Refresh the tenant app: <b>You owe Ksh 47,000</b>, with the overdue amount in red. <b>Bills</b> lists both bills; tap one to see its lines.", shots: ["21-tenant-owes", "22-tenant-bills"] },
    ],
  },
  {
    title: "Deposit, payment and receipt",
    steps: [
      { role: L, text: "On the lease page (<b>Leases → LSE-0001</b>), in the deposit card, click <b>Record received</b>. Amount <i>22000</i>, Reference <i>DEP-001</i> → <b>Save</b>. The deposit is held separately: it isn't added to what the tenant owes.", shots: ["23-deposit"] },
      { role: L, text: "Click <b>Record payment</b>. Amount <i>30000</i>, Paid via <i>Cash</i> → <b>Record payment</b>. A receipt (RCT-00001) is issued and the tenant is notified.", shots: ["24-payment"] },
      { role: L, text: "The balance drops to <b>Ksh 17,000</b>. The payment was applied to the oldest bill first.", shots: ["25-lease-after-payment"] },
      { role: L, text: "<b>Payments → RCT-00001 → Receipt</b> opens a printable receipt showing the new balance; <b>Download PDF</b> saves it as a document. Wanjiku's receipt email has the same PDF attached.", shots: ["26-receipt"] },
      { role: T, text: "In the tenant app, <b>Home</b> shows Ksh 17,000 owed and the deposit held. <b>Pay</b> shows the paybill and her account number, with copy buttons.", shots: ["27-tenant-after-payment", "28-tenant-pay"] },
    ],
  },
  {
    title: "Announcement",
    steps: [
      { role: L, text: "Sidebar <b>Communications</b>. Send to <i>All properties</i>, Title <i>Water interruption on Saturday</i>, a message, <b>Email</b> ticked → <b>Send</b> → <b>Send now</b>. It reaches every tenant with an active lease.", shots: ["29-announcement"] },
      { role: L, text: "The <b>Delivery log</b> tab records every email and SMS sent, with its status.", shots: ["30-delivery-log"] },
      { role: T, text: "The bell in the tenant app shows the announcement.", shots: ["31-tenant-bell"] },
    ],
  },
  {
    title: "A repair reported in the tenant app",
    intro: "Tenants report repairs with photos and follow progress. Staff can add internal notes that tenants never see.",
    steps: [
      { role: T, text: "<b>Repairs → Report a repair</b>. What kind <i>Plumbing</i>, How urgent <i>High</i>, What's wrong <i>Kitchen sink leaking</i>, details, and a photo (on a phone this opens the camera) → <b>Send report</b>.", shots: ["32-tenant-report-repair"] },
      { role: L, text: "Sidebar <b>Maintenance</b> → open the request (marked <i>from tenant</i>). Click <b>Acknowledge</b>; assign it and set a visit date → <b>Save assignment</b>; add a <b>Quotation</b> of 2,500 and <b>Approve</b> it; click <b>Start work</b>. Add an <b>internal note</b> (tick the box) and a normal update: <i>The plumber comes back tomorrow at 10am</i>.", shots: ["33-maintenance"] },
      { role: T, text: "The tenant sees <b>Being fixed</b> and the landlord's update, but <b>not</b> the internal note. She replies <i>Thanks, someone will be home</i>.", shots: ["34-tenant-repair-update"] },
      { role: L, text: "Refresh to see her reply, then <b>Mark resolved</b> and <b>Close</b>. The tenant sees <b>Closed</b>.", shots: ["35-maintenance-closed"] },
    ],
  },
  {
    title: "Moving out: the notice",
    intro: "A notice stays private until the landlord acknowledges it, so the unit isn't shown as becoming free too early.",
    steps: [
      { role: T, text: `<b>Move out</b>. Date <i>${TODAY}</i>, a message → <b>Send notice</b> → confirm. She can withdraw it until it's acknowledged.`, shots: ["36-tenant-notice"] },
      { role: L, text: "Sidebar <b>Move-outs</b> → Wanjiku: <i>Given by the tenant from the portal</i>, status <b>New notice</b>. Click <b>Acknowledge</b> (staff notes optional) → <b>Acknowledge</b>.", shots: ["37-notice-new"] },
      { role: L, text: "R1 now shows <b>Notice submitted</b> on the property page, and the tenant sees <b>Acknowledged</b>.", shots: ["38-unit-notice-submitted"] },
    ],
  },
  {
    title: "Moving out: the inspection",
    steps: [
      { role: L, text: `On the move-out page click <b>Schedule inspection</b>. Date <i>${TODAY}</i> → <b>Schedule</b>. The tenant is told the date.`, shots: ["39-schedule-inspection"] },
      { role: T, text: "Her <b>Move out</b> screen shows each step: notice sent, acknowledged, the inspection date, then the final settlement.", shots: ["40-tenant-notice-steps"] },
      { role: L, text: "Click the inspection reference (<b>INS-0001</b>). Set every item to <b>Good</b>, except Living room <b>Windows</b> → <b>Damaged</b>: notes and a charge box appear. Notes <i>Window pane cracked</i>, Charge <i>3000</i> → <b>Save checklist</b>.", shots: ["41-checklist"] },
      { role: L, text: "Click <b>Complete</b>. Keys returned <i>2</i>, tick <b>Tenant was present</b>, both signatures (type the names) → <b>Complete inspection</b>. The checklist is then locked.", shots: ["42-complete-inspection"] },
    ],
  },
  {
    title: "Moving out: settlement",
    intro: "One step ends the lease, bills any final days, deducts damages, uses the deposit for unpaid rent and records the refund.",
    steps: [
      { role: L, text: "Back on <b>Move-outs → Wanjiku</b>, the <b>Settle and close</b> card shows: deposit 22,000, damages 3,000, owed 17,000, deposit applied 17,000, <b>refund 2,000</b>, balance after 0. Set <b>Unit R1 becomes</b> <i>Available</i>, <b>Refund paid by</b> <i>M-Pesa</i> with a reference → <b>Complete move-out</b> → confirm.", shots: ["43-settlement"], note: "Damages come from the inspection. Type a different amount in <b>Damages override</b>, or untick <i>Use the remaining deposit to clear unpaid rent and charges</i> to refund the whole remainder." },
      { role: L, text: "The notice shows <b>Moved out</b> with a <b>Final settlement</b> record.", shots: ["44-final-settlement"] },
    ],
  },
  {
    title: "The end state",
    steps: [
      { role: L, text: "The lease shows <b>Ended</b> with balance 0. The deposit card shows the 3,000 deduction and the 2,000 refund.", shots: ["45-lease-ended"] },
      { role: L, text: "On the property page, R1 is <b>Available</b> and ready to let again.", shots: ["46-unit-available"] },
      { role: T, text: "The tenant app says <i>You're all paid up</i>, the home is marked <b>Ended</b>, and <b>Move out</b> shows <b>Moved out</b>. Her bills and receipts stay available.", shots: ["47-tenant-paid-up", "48-tenant-moved-out"] },
      { role: L, text: "Sidebar <b>Audit log</b> lists every action above, by staff and by the tenant, with who did it and when.", shots: ["49-audit-log"] },
    ],
  },
  {
    title: "Every tab in the landlord dashboard",
    reference: true,
    intro: "A reference to the landlord's window. The sidebar on the left lists every area; it shows only what your role is allowed to use, so a caretaker or accountant sees fewer tabs than the owner. The sidebar stays in place while a page scrolls (on a short screen the list of tabs scrolls on its own). On a phone or small screen it folds into the ☰ menu at the top left.",
    steps: [
      { tab: "Header", text: "Top right of every page. The <b>bell</b> lists your notifications (new repairs, move-out notices, leases ending) with a red count of unread ones; click one to open it, or <b>Mark all read</b>. The <b>round initials</b> open your account menu: <b>My account</b>, <b>My tenant portal</b> if you also rent somewhere, and <b>Sign out</b>. If you belong to more than one organization, switch between them with the name at the top of the sidebar.", shots: ["tab-bell", "tab-account-menu"] },
      { tab: "Overview", text: "Your organization at a glance: properties, units and occupancy; what was billed and collected this month; what's outstanding and overdue; deposits held (kept apart from income); team members and pending invitations; leases ending in the next 60 days; and recent activity. Start here each morning.", shots: ["tab-overview"] },
      { tab: "Properties", text: "Your buildings, with their units and occupancy. <b>Add property</b> to create one. Open a property for its tabs: <b>Units</b> (a colour-coded grid; click a unit to change its status, or add one or several), <b>Unit types</b> (the kinds of home with default rent and deposit), <b>Details</b> (address, amenities, map), <b>Photos &amp; files</b>, and <b>Staff access</b> (which managers and caretakers can work on it).", shots: ["tab-properties"] },
      { tab: "Units", text: "Every unit across your properties in one list, with its status, type and tenant. Filter by property or status to find vacant units quickly. Click a unit to see its details, edit it or change its status (e.g. under maintenance).", shots: ["tab-units"] },
      { tab: "Tenants", text: "Everyone renting from you. <b>Register tenant</b> to add someone. A tenant's page shows contacts, ID details (visible only to staff who manage tenants), their leases, balance owed, documents, and the <b>Tenant app</b> card to invite them. Archiving hides a tenant but keeps their history.", shots: ["tab-tenants"] },
      { tab: "Leases", text: "All tenancies, with an <b>Expiring</b> tab for leases ending soon. <b>New lease</b> lets a unit. A lease page is the tenant's account: balance and statement, <b>Record payment</b>, <b>One-off invoice</b> for extra charges, the rent schedule (<b>Schedule rent change</b>), the deposit, documents, <b>Record move-out notice</b> and <b>End lease</b>.", shots: ["tab-leases"] },
      { tab: "Maintenance", text: "Repairs reported by tenants (in the tenant app) and by staff. Switch the view between <b>Open</b>, <b>Assigned to me</b> and <b>All</b>, and filter by urgency or status. <b>New request</b> logs one reported by phone. A request page has the status buttons, updates (visible to the tenant, or internal), assignment and visit date, quotes and costs (only for staff allowed to see costs), and photos.", shots: ["tab-maintenance"] },
      { tab: "Inspections", text: "Move-in, move-out and routine inspections. <b>Schedule inspection</b> picks the unit, kind, date and inspector; a standard checklist is added. Fill in each item's condition, add notes, photos and (for move-out) damage charges, then <b>Complete</b> with signatures. Move-out damages flow into the settlement.", shots: ["tab-inspections"] },
      { tab: "Move-outs", text: "Notices to vacate, from the tenant app or recorded by staff (<b>Record notice</b>). A notice stays private until you acknowledge it. Each notice takes you through the inspection and the one-step settlement: final bill, damages, deposit, refund, lease closed and unit released.", shots: ["tab-move-outs"] },
      { tab: "Listings", text: "Advertise vacant units on the public website (the <b>Find a home</b> page). <b>New listing</b> picks a unit and sets a title, description, available-from date and the photos to show; only the town and county are public, never the street address, and only the photos you tick are published. A listing is shown while it is published and the unit is free to let, and comes down by itself once the unit is let. <b>Enquiries &amp; viewings</b> collects questions and viewing requests from the website (you're notified of each one): call them, <b>book a viewing</b> (they're emailed the time), keep internal notes, and close each one with its outcome.", shots: ["tab-listings"] },
      { tab: "Communications", text: "<b>Announcements</b> to all tenants or one property, by app notification, email and SMS. <b>Delivery log</b>: every email and SMS sent, and whether it was delivered. <b>Reminders &amp; channels</b>: switch email and SMS on or off, invoice and receipt notices, how many days before the due date rent reminders go out, arrears reminders, and lease-expiry alerts.", shots: ["tab-communications"] },
      { tab: "Billing", text: "<b>Generate invoices</b> bills a month for everyone, with a preview first; running a month again only adds what's new. <b>Invoices</b> lists every bill with outstanding and overdue filters; open one to see its lines, credit part of it, or void it. <b>Billing runs</b> is the history of monthly runs. <b>Shared costs</b> splits a bill such as common-area electricity between units. To bill every month without clicking, switch on <b>Automatic billing</b> under Charges.", shots: ["tab-billing"] },
      { tab: "Payments", text: "Money received and receipts. <b>Record payment</b> for cash, bank or M-Pesa received outside the system. <b>Unmatched</b>: payments that arrived without a recognisable account number; <b>Match</b> them to a tenant. <b>M-Pesa requests</b>: payment prompts sent to tenants' phones. <b>Bank imports</b>: upload a bank statement (CSV) and payments are matched to tenants by reference. Every payment has a receipt to print or download as a PDF; invoices have <b>Download PDF</b> too, and both PDFs are attached to the tenant's emails.", shots: ["tab-payments"] },
      { tab: "Expenses", text: "Your running costs outside repairs: utility bills, guards, cleaning and garbage, salaries, land rates, insurance, agent and professional fees, bank and M-Pesa charges. <b>Record expense</b> with the property (or <b>Organization-wide</b> for costs such as office rent), category, date, amount and who was paid. Filter by property, category or dates; the cards show what was spent this month and this year. Correct an expense with the pencil (changes are audited); one entered by mistake is <b>voided</b> with a reason rather than deleted (owners only, unless they delegate it). Expenses count in the Financial summary and the Expenses report. Repairs are recorded on maintenance requests instead.", shots: ["tab-expenses"] },
      { tab: "Reports", text: "Reports for any month, year or dates you choose, for one property or all: <b>Financial summary</b> (billed by income category, received by payment method, maintenance costs and other expenses, net operating income, deposits and arrears, with a month-by-month chart), <b>Rent roll</b>, <b>Arrears</b> by how long they're overdue, <b>Occupancy</b> with vacant units, <b>Deposits</b>, <b>Maintenance costs</b> and <b>Expenses</b> (all spending by category and property). Download any report as <b>PDF</b>, <b>Excel</b> or <b>CSV</b> for your accountant. A month's rent counts in that month even if it was invoiced later.", shots: ["tab-reports"] },
      { tab: "Utilities", text: "Water and electricity meters per unit. Add a meter to a unit, then enter readings for a whole property at once. Usage between two readings is billed once, at the unit's metered rate (set under <b>Charges</b>).", shots: ["tab-utilities"] },
      { tab: "Charges", text: "What tenants pay besides rent: security, garbage, water, parking and so on. <b>Add rule</b> sets the amount, how it's billed (fixed monthly, metered, or shared), who it applies to (all properties, a property, a unit type or one unit) and from which date. The most specific rule wins, so you can exempt a unit or charge it differently. Nothing is billed for a charge until it has an enabled rule. <b>Charge types</b> are the names used on invoices. <b>Automatic billing</b> generates each month's invoices by itself on the day you choose (safe to repeat: nothing is billed twice).", shots: ["tab-charges"] },
      { tab: "Payment settings", text: "How tenants pay you: M-Pesa paybill or till, bank account, or cash, for all properties or one property. These are your own accounts; Nexora never holds tenants' money. Connecting M-Pesa (Daraja) lets payments match tenants automatically and lets tenants get a payment prompt on their phone.", shots: ["tab-payment-settings"] },
      { tab: "Team", text: "Who can work in your organization. <b>Members</b>: each person's role (Owner, Property manager, Accountant, Caretaker), and <b>Edit access</b> to grant or remove individual permissions and assign properties. <b>Invitations</b>: invite someone by email and see pending invitations.", shots: ["tab-team"] },
      { tab: "Audit log", text: "A permanent record of every change: who did what and when, including actions tenants take in the app. Search it by action, person or record. Entries can't be edited or deleted.", shots: ["tab-audit-log"] },
      { tab: "Organization", text: "Your organization's details: name, legal name, contact phone and email (shown to tenants on receipts and in the tenant app), address, country, currency and time zone.", shots: ["tab-organization"] },
      { tab: "Subscription", text: "Owners only. Your Nexora plan and how many units it allows, the units you use, and Nexora's invoices to you. A new organization starts with a 30-day free trial. A week before it ends you get an invoice: pay it with an M-Pesa prompt to your phone, or to Nexora's paybill or bank account with the account number shown. <b>Switch to</b> another plan at any time; a smaller plan must still fit your units. If an invoice stays unpaid, a banner warns you, and 14 days after access ends Nexora becomes <b>read-only</b> (you can still see and download everything) until it's paid.", shots: ["tab-subscription"] },
      { tab: "My account", text: "Your own name, phone and password.", shots: ["tab-my-account"] },
    ],
  },
  {
    title: "Tenants moving in mid-month",
    intro: "By default, a tenant who moves in part-way through a month pays only for the days they're there: rent 13,000 from the 29th of a 31-day month bills 3 days, Ksh 1,258.06. If your agreement says the first month is paid in full, switch this on.",
    steps: [
      { role: L, text: "<b>On a new lease:</b> when the start date isn't the 1st, the form shows <b>Charge the first month in full</b>, with both amounts so you can compare. Tick it before <b>Create lease</b>.", shots: ["09b-first-month-option"] },
      { role: L, text: "<b>On an existing lease:</b> the summary shows <b>First month: Prorated from the start date</b>. Click <b>Change</b> and confirm.", shots: ["50-first-month-row", "51-first-month-confirm"], note: "<b>Already billed the first month prorated?</b> Open that invoice and <b>Void</b> it, switch the option on the lease, then <b>Generate invoices</b> for that month again. The option can't be changed while the first month is on an issued invoice." },
      { role: L, text: "The bill now charges the whole month, marked <i>(first month charged in full)</i>. Fixed monthly charges such as security are charged in full too. Later months are billed as normal.", shots: ["52-first-month-preview"] },
    ],
  },
];

const ROLE = {
  [L]: { label: "Landlord", cls: "landlord" },
  [T]: { label: "Tenant app", cls: "tenant" },
  email: { label: "Email inbox", cls: "email" },
};

const kinds = JSON.parse(fs.readFileSync(path.join(SCREENS, "manifest.json"), "utf8"));

function img(name) {
  const file = path.join(SCREENS, `${name}.jpg`);
  if (!fs.existsSync(file)) throw new Error(`Missing screenshot ${name}.jpg: run the capture first.`);
  return `<img class="shot ${kinds[name] ?? "screen"}" src="screens/${name}.jpg" alt="">`;
}

let n = 0;
const body = sections
  .map((section, s) => {
    const steps = section.steps
      .map((step) => {
        const shots = (step.shots ?? []).map((name) => img(name)).join("");
        let head;
        if (section.reference) {
          head = `<span class="tabname">${step.tab === "Header" ? "Header" : `Sidebar → ${step.tab}`}</span>`;
        } else {
          n += 1;
          const role = ROLE[step.role];
          head = `<span class="num">${n}</span><span class="role ${role.cls}">${role.label}</span>`;
        }
        return `
        <div class="step ${step.role === T ? "is-phone" : ""}">
          <div class="step-head">${head}</div>
          <div class="step-body">
            <p>${step.text}</p>
            ${step.note ? `<p class="note">${step.note}</p>` : ""}
            <div class="shots">${shots}</div>
          </div>
        </div>`;
      })
      .join("");
    return `
      <section class="chapter">
        <h2><span>${s + 1}</span>${section.title}</h2>
        ${section.intro ? `<p class="intro">${section.intro}</p>` : ""}
        ${steps}
      </section>`;
  })
  .join("");

const toc = sections.map((s, i) => `<li><span>${i + 1}</span>${s.title}</li>`).join("");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Nexora user manual</title>
<style>
  @page { size: A4; margin: 16mm 14mm 18mm; }
  :root { --navy: #0b2545; --green: #0f9d76; --red: #e11d48; --muted: #5b6475; --line: #e3e7ee; --tint: #f5f7fa; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #1d2433; font-size: 10.5pt; line-height: 1.5; margin: 0; }
  b { color: #111827; }
  .cover { height: 255mm; display: flex; flex-direction: column; justify-content: center; page-break-after: always; }
  .cover .mark { width: 22mm; height: 22mm; border-radius: 5mm; background: var(--navy); display: flex; align-items: center; justify-content: center; margin-bottom: 10mm; }
  .cover h1 { font-size: 30pt; line-height: 1.15; margin: 0 0 4mm; color: var(--navy); }
  .cover .sub { font-size: 14pt; color: var(--muted); margin: 0 0 14mm; }
  .cover .meta { font-size: 10pt; color: var(--muted); border-top: 1px solid var(--line); padding-top: 4mm; }
  h2 { color: var(--navy); font-size: 17pt; margin: 0 0 3mm; display: flex; align-items: center; gap: 3mm; }
  h2 span { display: inline-flex; width: 9mm; height: 9mm; border-radius: 50%; background: var(--navy); color: #fff; font-size: 11pt; align-items: center; justify-content: center; }
  h3 { color: var(--navy); font-size: 12pt; margin: 6mm 0 2mm; }
  .chapter { page-break-before: always; }
  .intro { color: var(--muted); margin: 0 0 5mm; }
  .step { margin: 0 0 7mm; break-inside: avoid; }
  .step-head { display: flex; align-items: center; gap: 2.5mm; margin-bottom: 1.5mm; }
  .num { display: inline-flex; min-width: 7mm; height: 7mm; padding: 0 1.5mm; border-radius: 3.5mm; background: var(--tint); border: 1px solid var(--line); font-weight: 700; font-size: 9.5pt; align-items: center; justify-content: center; }
  .role { font-size: 8.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; padding: .6mm 2.2mm; border-radius: 2mm; }
  .role.landlord { background: #e8eef7; color: var(--navy); }
  .step:has(.tabname) .shots:has(.crop) { justify-content: flex-start; }
  .tabname { font-weight: 700; font-size: 11.5pt; color: var(--navy); border-left: 3px solid var(--green); padding-left: 2.5mm; }
  .role.tenant { background: #e3f5ef; color: #087356; }
  .role.email { background: #fdf0e1; color: #92510b; }
  .step-body p { margin: 0 0 2mm; }
  .note { background: #fff8e6; border-left: 3px solid #f0b429; padding: 2mm 3mm; border-radius: 1mm; font-size: 9.5pt; }
  .shots { display: flex; gap: 4mm; flex-wrap: wrap; align-items: flex-start; }
  .shot { border: 1px solid var(--line); border-radius: 2mm; box-shadow: 0 1px 3px rgba(15, 23, 42, .08); }
  .shot.screen { width: 100%; }
  .shot.tall { display: block; max-width: 100%; max-height: 225mm; margin: 0 auto; }
  .shot.crop { max-width: 105mm; max-height: 135mm; margin: 0 auto; }
  .shot.phone { width: 56mm; border-radius: 4mm; }
  .shots:has(.crop) { justify-content: center; }
  /* Tenant app steps: text beside the phone picture(s). */
  .step.is-phone .step-body { display: grid; grid-template-columns: 1fr auto; gap: 6mm; align-items: start; }
  .step.is-phone .shots { flex-wrap: nowrap; }
  table { border-collapse: collapse; width: 100%; margin: 2mm 0 5mm; font-size: 10pt; }
  th, td { text-align: left; padding: 2mm 3mm; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { background: var(--tint); color: var(--navy); }
  td.amt { text-align: right; white-space: nowrap; }
  code { font-family: ui-monospace, Menlo, monospace; font-size: 9.5pt; background: var(--tint); padding: .3mm 1.2mm; border-radius: 1mm; }
  .toc { list-style: none; padding: 0; columns: 2; column-gap: 10mm; }
  .toc li { padding: 1.5mm 0; border-bottom: 1px dotted var(--line); break-inside: avoid; }
  .toc span { display: inline-block; width: 7mm; color: var(--green); font-weight: 700; }
  .legend { display: flex; gap: 3mm; flex-wrap: wrap; align-items: center; }
  .outline-sample { display: inline-block; width: 12mm; height: 5mm; border: 2px solid var(--red); border-radius: 1mm; vertical-align: middle; }
  .page { page-break-after: always; }
</style></head>
<body>
  <div class="cover">
    <div class="mark"><svg viewBox="0 0 32 32" width="60" height="60"><path d="M9 23V9l14 14V9" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="23" cy="9" r="2.6" fill="#0f9d76"/></svg></div>
    <h1>Nexora property management</h1>
    <p class="sub">Step-by-step guide: a tenancy from setting up a property to the tenant moving out, as the landlord and in the tenant app</p>
    <div class="meta">Screens captured ${TODAY} · ${n} steps · Nexora (local demo environment)</div>
  </div>

  <div class="page">
    <h2>Before you start</h2>
    <h3>Links</h3>
    <table>
      <tr><th>What</th><th>Link</th></tr>
      <tr><td><b>Landlord</b>: your normal browser window</td><td><code>http://localhost:3000/register</code> to sign up,<br><code>http://localhost:3000/login</code> next time</td></tr>
      <tr><td><b>Tenant app</b>: use a private / incognito window, or a phone</td><td><code>http://localhost:3000/portal</code>, reached through the invitation email first</td></tr>
      <tr><td><b>Email inbox</b>: catches every email the app sends</td><td><code>http://localhost:8025</code></td></tr>
    </table>
    <p>Use a new email for yourself as the landlord and a different one for the tenant (e.g. <i>wanjiku@test.com</i>). Any made-up address works, because every email lands in the inbox above.</p>
    <p><b>Dates:</b> the lease starts on <b>${START}</b> (the 1st of last month), so you bill <b>${M1}</b> and <b>${M2}</b>. The move-out happens today, <b>${TODAY}</b>.</p>
    <h3>Money used throughout</h3>
    <table>
      <tr><th>Item</th><th class="amt">KES</th></tr>
      <tr><td>Monthly rent + security charge</td><td class="amt">22,000 + 1,500 = 23,500</td></tr>
      <tr><td>Billed for two months</td><td class="amt">47,000</td></tr>
      <tr><td>Deposit received</td><td class="amt">22,000</td></tr>
      <tr><td>Cash payment</td><td class="amt">30,000 → balance 17,000</td></tr>
      <tr><td>Damage found at move-out</td><td class="amt">3,000</td></tr>
      <tr><td>Deposit used to clear the balance</td><td class="amt">17,000</td></tr>
      <tr><td>Refund to the tenant</td><td class="amt">2,000</td></tr>
    </table>
    <h3>Reading this guide</h3>
    <div class="legend">
      <span class="role landlord">Landlord</span> steps happen in the landlord window;
      <span class="role tenant">Tenant app</span> steps in the private window or phone.
      <span class="outline-sample"></span> marks the button to press.
    </div>
  </div>
  <div class="page">
    <h2>Contents</h2>
    <ol class="toc">${toc}</ol>
    <h3 style="margin-top:10mm">For the demo</h3>
    <p>Show the tenant app at phone size: in the tenant window press <b>⌥⌘I</b> (Windows: F12), click the phone icon and pick a phone. On a real phone, the app can be added to the home screen and opens like any other app.</p>
  </div>

  ${body}
</body></html>`;

fs.writeFileSync(path.join(OUT, "manual.html"), html);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(path.join(OUT, "manual.html")).href, { waitUntil: "load" });
await page.pdf({
  path: path.join(OUT, "Nexora-User-Manual.pdf"),
  format: "A4",
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate:
    '<div style="width:100%;font-size:8px;color:#5b6475;padding:0 14mm;display:flex;justify-content:space-between;font-family:Helvetica,Arial,sans-serif"><span>Nexora property management · step-by-step guide</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
  margin: { top: "16mm", bottom: "18mm", left: "14mm", right: "14mm" },
});
await browser.close();
console.log(`Wrote ${path.join(OUT, "Nexora-User-Manual.pdf")} (${n} steps)`);
