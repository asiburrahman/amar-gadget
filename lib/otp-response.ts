import { NextResponse } from "next/server";
import { OtpError } from "@/lib/otp";
import { PasswordWorkloadBusy } from "@/lib/password";
import type { OtpMailResult } from "@/lib/mail/send-otp";

export function otpDeliveryFailure(result: Extract<OtpMailResult, { success: false }>) {
  return NextResponse.json({ success: false, message: result.error }, { status: result.status, headers: result.retryAfter ? { "Retry-After": String(result.retryAfter) } : undefined });
}
export function otpErrorResponse(error: unknown) {
  if (error instanceof OtpError) return NextResponse.json({ success: false, message: error.message }, { status: error.status, headers: error.retryAfter ? { "Retry-After": String(error.retryAfter) } : undefined });
  if (error instanceof PasswordWorkloadBusy) return NextResponse.json({ success: false, message: error.message }, { status: 503, headers: { "Retry-After": "5" } });
  if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return NextResponse.json({ success: false, message: "This email is no longer available. Request a code for a different address." }, { status: 409 });
  console.error("Account verification request failed; sensitive details were not logged.");
  return NextResponse.json({ success: false, message: "Verification is temporarily unavailable. Please retry." }, { status: 503 });
}
