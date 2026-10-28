import { z } from "zod";

export const accountEmailSchema = z.string().trim().email("Invalid email address").max(254).toLowerCase();
export const otpCodeSchema = z.string().trim().regex(/^\d{6}$/, "OTP must be 6 digits");
export const passwordInputSchema = z.string().min(1, "Password is required").max(4096, "Password is too long");
export const PASSWORD_POLICY_MESSAGE = "Use 8–128 characters with uppercase, lowercase, a number and a special character.";
const databaseText = (maximum: number) => z.string().trim().max(maximum).refine((value) => !value.includes("\0"), "Null characters are not allowed");
export const newPasswordSchema = z.string().min(8, PASSWORD_POLICY_MESSAGE).max(128, PASSWORD_POLICY_MESSAGE)
  .regex(/[A-Z]/, PASSWORD_POLICY_MESSAGE).regex(/[a-z]/, PASSWORD_POLICY_MESSAGE)
  .regex(/\d/, PASSWORD_POLICY_MESSAGE).regex(/[!@#$%^&*(),.?":{}|<>]/, PASSWORD_POLICY_MESSAGE);
const httpsUrl = z.string().max(2048).url().refine((value) => {
  try {
    const url = new URL(value);
    return !value.includes("\0") && url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}, "Use an HTTPS image URL without embedded credentials");
// Preserve the existing bounded raster-data representation until AUD-038
// migrates every avatar writer to owned storage and signature validation.
export const accountAvatarSchema = z.union([z.literal(""), httpsUrl, z.string().max(7 * 1024 * 1024).regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/)]);

export const loginSchema = z.object({
  email: accountEmailSchema,
  password: passwordInputSchema,
});

export const registerSchema = z.object({
  name: databaseText(120).min(2, "Name must be at least 2 characters"),
  email: accountEmailSchema,
  password: newPasswordSchema,
  confirmPassword: passwordInputSchema.optional(),
  avatar: accountAvatarSchema.optional(),
  role: z.enum(["USER", "MEMBER"]).default("USER"),
});

export const verifyOtpSchema = z.object({
  email: accountEmailSchema,
  otp: otpCodeSchema,
  password: passwordInputSchema,
});

export const forgotPasswordSchema = z.object({
  email: accountEmailSchema,
});

export const resetPasswordSchema = z.object({ email: accountEmailSchema, otp: otpCodeSchema, newPassword: newPasswordSchema, confirmPassword: passwordInputSchema.optional() })
  .refine((input) => input.confirmPassword === undefined || input.confirmPassword === input.newPassword, { message: "Passwords do not match", path: ["confirmPassword"] });
export const changePasswordSchema = z.object({ currentPassword: passwordInputSchema, newPassword: newPasswordSchema, confirmPassword: passwordInputSchema })
  .refine((input) => input.confirmPassword === input.newPassword, { message: "Passwords do not match", path: ["confirmPassword"] });
export const emailChangeRequestSchema = z.object({ newEmail: accountEmailSchema, currentPassword: passwordInputSchema });
export const emailChangeVerifySchema = z.object({ newEmail: accountEmailSchema, otp: otpCodeSchema });

const addressSchema = z.object({
  fullName: databaseText(120).min(2), phone: databaseText(32).min(5),
  street: databaseText(500).min(1), city: databaseText(100).min(1),
  district: databaseText(100).min(1), zipCode: databaseText(20).nullable().optional(),
}).strict();
export const profileUpdateSchema = z.object({ name: databaseText(120).min(2).optional(), phone: databaseText(32).optional(), avatar: accountAvatarSchema.optional(), address: addressSchema.optional() })
  .strict().refine((input) => Object.keys(input).length > 0, "Provide profile fields to update");

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
