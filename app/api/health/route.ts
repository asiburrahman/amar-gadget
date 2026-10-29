import { NextResponse } from "next/server";

// Process liveness only. Route traffic using /api/health/ready.
export function GET() {
  return NextResponse.json({ status: "OK", check: "liveness" }, { headers: { "Cache-Control": "no-store" } });
}
