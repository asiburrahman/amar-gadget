import { z } from "zod";

export const accountEmailSchema = z.string().trim().email("Invalid email address").max(254).toLowerCase();
export const otpCodeSchema = z.string().trim().regex(/^\d{6}$/, "OTP must be 6 digits");

export const loginSchema = z.object({
  email: accountEmailSchema,
  password: z.string().min(1, "Password is required"),
});

export const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: accountEmailSchema,
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Must contain at least one uppercase letter")
    .regex(/[a-z]/, "Must contain at least one lowercase letter")
    .regex(/\d/, "Must contain at least one number")
    .regex(/[!@#$%^&*(),.?":{}|<>]/, "Must contain at least one special character"),
  confirmPassword: z.string().optional(),
  avatar: z.string().optional(),
  role: z.enum(["USER", "MEMBER"]).default("USER"),
});

export const verifyOtpSchema = z.object({
  email: accountEmailSchema,
  otp: otpCodeSchema,
  password: z.string().min(1, "Enter the password used for registration"),
});

export const forgotPasswordSchema = z.object({
  email: accountEmailSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
