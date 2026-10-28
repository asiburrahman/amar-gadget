import { issueOtp, OtpError, type OtpPurpose } from "@/lib/otp";
import { getMailTransport, MailConfigurationError } from "./nodemailer";

export type OtpMailResult = { success: true } | { success: false; error: string; status: number; retryAfter?: number };

export async function sendOtpEmail(context: { userId: string; email: string; purpose: OtpPurpose; expectedAccountFingerprint?: string }): Promise<OtpMailResult> {
  try {
    const transport = getMailTransport();
    const from = process.env.SMTP_FROM?.trim();
    if (!from) throw new MailConfigurationError();
    const title = { REGISTRATION: "Verify your email", PASSWORD_RESET: "Reset your password", EMAIL_CHANGE: "Confirm your email change" }[context.purpose];
    await issueOtp(context, (code) => transport.sendMail({
      from, to: context.email.trim().toLowerCase(), subject: `Amar Gadget: ${title}`,
      text: `${title}. Your Amar Gadget code is ${code}. It expires in 10 minutes. Do not share it. If you did not request this action, ignore this message.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:500px;margin:auto;padding:24px;border:1px solid #e2e8f0;border-radius:12px"><h1>Amar Gadget</h1><h2>${title}</h2><p>Use this code to complete this specific request:</p><p style="font-size:32px;font-weight:bold;letter-spacing:6px">${code}</p><p>This code expires in 10 minutes. Do not share it. If you did not request this action, ignore this message.</p></div>`,
    }));
    return { success: true };
  } catch (error) {
    if (error instanceof OtpError) return { success: false, error: error.message, status: error.status, retryAfter: error.retryAfter };
    console.error("OTP email delivery failed; no code or credential was logged.");
    return { success: false, error: "Email delivery is temporarily unavailable. Please retry shortly.", status: 503 };
  }
}
