import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { success: false, message: "Cart persistence is not available; the storefront uses a browser-local cart." },
    { status: 501 }
  );
}
