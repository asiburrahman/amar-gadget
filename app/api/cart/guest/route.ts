import { NextResponse } from "next/server";
import { AccountRequestError, limitAccountIp, readAccountJson } from "@/lib/account-request";
import { guestCartResolveSchema } from "@/lib/validations/cart";
import { resolveCartLines } from "@/lib/cart";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    await limitAccountIp(request, "guest-cart-resolve", 90);
    const parsed = guestCartResolveSchema.safeParse(await readAccountJson(request));
    if (!parsed.success) return NextResponse.json({ success: false, message: "Check the guest cart references and quantities." }, { status: 400, headers });
    return NextResponse.json({ success: true, lines: await resolveCartLines(parsed.data.lines) }, { headers });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof AccountRequestError ? error.message : "Current cart products are unavailable." }, { status: error instanceof AccountRequestError ? error.status : 503, headers: { ...headers, ...(error instanceof AccountRequestError && error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
  }
}
