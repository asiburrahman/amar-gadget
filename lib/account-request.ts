import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { otpErrorResponse } from "@/lib/otp-response";

export class AccountRequestError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfter?: number) { super(message); }
}

/** Limit decoded input before JSON allocation; also handles missing/false lengths. */
export async function readAccountJson(request: Request, maximumBytes = 16 * 1024): Promise<unknown> {
  const tooLarge = () => new AccountRequestError("Request body is too large.", 413);
  if (Number(request.headers.get("content-length")) > maximumBytes) throw tooLarge();
  if (!request.body) throw new AccountRequestError("A JSON request body is required.", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) { await reader.cancel().catch(() => undefined); throw tooLarge(); }
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks, length);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof AccountRequestError) throw error;
    throw new AccountRequestError("Provide a valid JSON request body.", 400);
  } finally { reader.releaseLock(); }
}

export async function limitAccountIp(request: Pick<Request, "headers">, operation: string, limit = 10, windowSeconds = 60) {
  if (!(await rateLimit(getClientIp(request.headers), limit, windowSeconds, `${operation}:ip`)).success) throw new AccountRequestError("Too many requests. Try again shortly.", 429, windowSeconds);
}
export async function limitAccountIdentity(identity: string, operation: string, limit = 5, windowSeconds = 600) {
  // No raw email/account identity in the limiter's storage key or logs.
  const key = createHash("sha256").update(identity).digest("hex");
  if (!(await rateLimit(key, limit, windowSeconds, `${operation}:account`)).success) throw new AccountRequestError("Too many requests for this account. Try again later.", 429, windowSeconds);
}
export function accountErrorResponse(error: unknown) {
  if (error instanceof AccountRequestError) return NextResponse.json({ success: false, message: error.message }, { status: error.status, headers: error.retryAfter ? { "Retry-After": String(error.retryAfter) } : undefined });
  return otpErrorResponse(error);
}
