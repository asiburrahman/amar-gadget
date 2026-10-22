import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { success: false, message: "Stripe customer portal is not configured." },
    { status: 501 }
  );
}
