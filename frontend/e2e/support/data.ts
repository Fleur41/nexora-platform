/** Test data and dates for the regression journey. Every run uses fresh, unique records. */

const unique = Date.now().toString(36);

/** Today in the organization's timezone (Africa/Nairobi by default), as YYYY-MM-DD. */
export const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date());

/** A month relative to the current one, as YYYY-MM. */
export function month(offset: number): string {
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 7);
}

export const owner = {
  name: "Regression Owner",
  email: `qa-owner-${unique}@example.com`,
  password: "Nexora-qa-pass-2026",
};

export const organization = `QA Homes ${unique}`;

export const property = { name: "Riverside Apartments", town: "Westlands", county: "Nairobi" };
export const unitType = { category: "one_bedroom", rent: "22000", deposit: "22000" };
export const unitPrefix = "R";

export const tenant = {
  name: "Wanjiku Kamau",
  phone: "0722 456 789",
  email: `qa-tenant-${unique}@example.com`,
  idNumber: `3${unique.slice(-7)}`,
  password: "Nexora-tenant-2026",
};

export const security = { charge: "Security", amount: "1500" };

/** A 1×1 PNG, enough for a photo upload. */
export const photo = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
