import { z } from "zod";
import { shippingAddressSchema, addressRevisionSchema } from "@/lib/validations/address";
import { avatarKeyFromUrl } from "@/lib/avatar-policy";

export const accountEmailSchema = z.string().trim().email("Invalid email address").max(254).toLowerCase();
export const otpCodeSchema = z.string().trim().regex(/^\d{6}$/, "OTP must be 6 digits");
export const passwordInputSchema = z.string().min(1, "Password is required").max(4096, "Password is too long");
export const PASSWORD_POLICY_MESSAGE = "Use 8–128 characters with uppercase, lowercase, a number and a special character.";
const databaseText = (maximum: number) => z.string().trim().max(maximum).refine((value) => !value.includes("\0"), "Null characters are not allowed");
export const newPasswordSchema = z.string().min(8, PASSWORD_POLICY_MESSAGE).max(128, PASSWORD_POLICY_MESSAGE)
  .regex(/[A-Z]/, PASSWORD_POLICY_MESSAGE).regex(/[a-z]/, PASSWORD_POLICY_MESSAGE)
  .regex(/\d/, PASSWORD_POLICY_MESSAGE).regex(/[!@#$%^&*(),.?":{}|<>]/, PASSWORD_POLICY_MESSAGE);
export const accountAvatarSchema = z.union([z.null(), z.literal(""), z.string().max(2048).refine((value) => {
  try { const owner = new URL(value).pathname.split("/")[2]; return !!owner && !!avatarKeyFromUrl(value, owner); } catch { return false; }
}, "Use the current saved photo reference or upload a new photo")]);

export const loginSchema = z.object({
  email: accountEmailSchema,
  password: passwordInputSchema,
});

export const registerSchema = z.object({
  name: databaseText(120).min(2, "Name must be at least 2 characters"),
  email: accountEmailSchema,
  password: newPasswordSchema,
  confirmPassword: passwordInputSchema.optional(),
  avatar: z.literal("").optional(),
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

export const profileUpdateSchema = z.object({ name: databaseText(120).min(2).optional(), phone: databaseText(32).optional(), avatar: accountAvatarSchema.optional(), avatarVersion: z.number().int().min(0).max(2147483646).optional(), address: shippingAddressSchema.optional(), addressRevision: addressRevisionSchema.nullable().optional() })
  .strict().refine((input) => Object.keys(input).length > 0, "Provide profile fields to update")
  .refine((input) => input.addressRevision === undefined || input.address !== undefined, "An address revision requires address fields.")
  .refine((input) => (input.avatar === undefined) === (input.avatarVersion === undefined), "Photo changes require the current photo revision.");

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
