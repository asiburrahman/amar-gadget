import { prisma } from "@/lib/prisma";
import { transporter } from "./nodemailer";

export async function sendOtpEmail(email: string): Promise<{ success: boolean; code?: string; error?: string }> {
  try {
    // Generate 6-digit numeric OTP code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

    // Save or update OtpToken in database
    await prisma.otpToken.create({
      data: {
        email: email.toLowerCase(),
        code,
        expiresAt,
      },
    });

    // Send email using Nodemailer
    const mailOptions = {
      from: `"Amar Gadget Security" <${process.env.SMTP_FROM || "asibur311@gmail.com"}>`,
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

    console.log(`[OTP GENERATED] Code for ${email} is: ${code}`);

    try {
      await transporter.sendMail(mailOptions);
    } catch (smtpError) {
      console.warn("SMTP email dispatch warning (OTP logged to console):", smtpError);
    }

    return { success: true, code };
  } catch (error: any) {
    console.error("Error sending OTP email:", error);
    return { success: false, error: error.message || "Failed to generate OTP" };
  }
}