import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { quoteRequestSchema } from "@/lib/validations/order";
import { calculateCheckoutQuote, CheckoutQuoteError } from "@/lib/checkout-quote";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const limit = await rateLimit(getClientIp(req.headers), 60, 60, "checkout-quote");
  if (!limit.success) return NextResponse.json({ message: "Too many quote requests. Please wait a minute." }, { status: 429 });
  const parsed = quoteRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "Check cart quantities and coupon code." }, { status: 400 });
  try {
    return NextResponse.json({ quote: await calculateCheckoutQuote(prisma, parsed.data) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof CheckoutQuoteError) return NextResponse.json({ code: error.code, message: error.message }, { status: 422 });
    return NextResponse.json({ message: "Unable to calculate your total. Please retry." }, { status: 503 });
  }
}
