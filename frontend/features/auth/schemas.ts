import { z } from "zod";

// Client-side checks are for fast feedback only; Django enforces the real rules
// (including its password validators) and its errors are shown on the same fields.

export const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export const passwordField = z
  .string()
  .min(10, "Use at least 10 characters.")
  .refine((v) => !/^\d+$/.test(v), "The password cannot be entirely numeric.");

export const registerSchema = z.object({
  full_name: z.string().trim().min(2, "Enter your full name.").max(150),
  email: z.string().trim().email("Enter a valid email address."),
  phone: z.string().trim().max(32).optional(),
  password: passwordField,
});

export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, "Enter your current password."),
    new_password: passwordField,
    confirm_password: z.string(),
  })
  .refine((v) => v.new_password === v.confirm_password, {
    path: ["confirm_password"],
    message: "Passwords do not match.",
  });

export const resetPasswordSchema = z
  .object({ new_password: passwordField, confirm_password: z.string() })
  .refine((v) => v.new_password === v.confirm_password, {
    path: ["confirm_password"],
    message: "Passwords do not match.",
  });

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
