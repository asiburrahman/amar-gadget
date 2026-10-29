import { NextResponse } from "next/server";
import { getReadiness } from "@/lib/readiness";

export const dynamic = "force-dynamic";
export async function GET() {
  const result = await getReadiness();
  return NextResponse.json(result, { status: result.status === "READY" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
