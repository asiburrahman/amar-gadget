import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { readSweepConfig } from "@/config/runtime";
import { prisma } from "@/lib/prisma";
import { sweepCardRefunds } from "@/lib/stripe/refunds";
export const maxDuration = 60;
export async function POST(request: Request) {
  let config: ReturnType<typeof readSweepConfig>;
  try { config = readSweepConfig(); } catch { return NextResponse.json({ error: "Refund reconciliation worker is not configured." }, { status: 503 }); }
  const expected = createHash("sha256").update(`Bearer ${config.CHECKOUT_SWEEP_SECRET}`).digest(), supplied = createHash("sha256").update(request.headers.get("authorization") ?? "").digest();
  if (!timingSafeEqual(expected, supplied)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const [actual] = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
    if (actual.name !== config.CHECKOUT_SWEEP_DATABASE) return NextResponse.json({ error: "Refund database does not match configured target." }, { status: 503 });
    return NextResponse.json(await sweepCardRefunds(2), { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Refund reconciliation failed; durable attempts remain available." }, { status: 503 }); }
}
