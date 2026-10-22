import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { success: false, message: "Notifications are not implemented." },
    { status: 501 }
  );
}
