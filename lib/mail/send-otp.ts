import { randomInt } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getMailTransport, MailConfigurationError } from "./nodemailer";

export async function sendOtpEmail(email: string): Promise<{ success: boolean; error?: string }> {
  try {
    const transporter = getMailTransport();
    const from = process.env.SMTP_FROM?.trim();
    if (!from) throw new MailConfigurationError();
    // Generate 6-digit numeric OTP code
    const code = randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

    // Delete any previous OTP tokens for this email
    await prisma.otpToken.deleteMany({
      where: { email: email.toLowerCase() },
    });

    // Save fresh OtpToken in database
    await prisma.otpToken.create({
      data: {
        email: email.toLowerCase(),
        code,
        expiresAt,
      },
    });

    // Send email using Nodemailer
    const mailOptions = {
      from,
      to: email,
      subject: "🔒 Amar Gadget Account Verification Code",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
          <div style="text-align: center; margin-bottom: 20px;">
            <h1 style="color: #2563eb; margin: 0;">Amar Gadget</h1>
            <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Email Verification Security Code</p>
          </div>
          <p style="font-size: 14px; color: #1e293b;">Hello,</p>
          <p style="font-size: 14px; color: #1e293b;">Thank you for registering on Amar Gadget. Please use the following 6-digit OTP verification code to authenticate your account:</p>
          <div style="text-align: center; margin: 30px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #2563eb; background-color: #eff6ff; padding: 12px 24px; border-radius: 8px; border: 1px dashed #2563eb; display: inline-block;">
              ${code}
            </span>
          </div>
          <p style="font-size: 12px; color: #64748b; text-align: center;">This verification code expires in 10 minutes. Do not share this code with anyone.</p>
        </div>
      `,
    };

    try {
      await transporter.sendMail(mailOptions);
    } catch (error) {
      await prisma.otpToken.deleteMany({ where: { email: email.toLowerCase(), code } });
      throw error;
    }

    return { success: true };
  } catch {
    console.error("OTP email delivery failed; no code or credential was logged.");
    return { success: false, error: "Email delivery is temporarily unavailable. Please retry shortly." };
  }
}
