import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

export const organizationSchema = z.object({
  name: z.string().trim().min(2, "Enter the organization name.").max(200),
  legal_name: optionalText(255),
  email: z.string().trim().email("Enter a valid email address.").optional().or(z.literal("")),
  phone: optionalText(32),
  address: optionalText(255),
  country: z.string().trim().length(2, "Use a 2-letter country code, e.g. KE."),
  currency: z.string().trim().length(3, "Use a 3-letter currency code, e.g. KES."),
  timezone: z.string().trim().min(1, "Choose a timezone."),
});

export type OrganizationValues = z.infer<typeof organizationSchema>;

export const ORGANIZATION_DEFAULTS: OrganizationValues = {
  name: "",
  legal_name: "",
  email: "",
  phone: "",
  address: "",
  country: "KE",
  currency: "KES",
  timezone: "Africa/Nairobi",
};
