import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { readSweepConfig } from "@/config/runtime";
import { prisma } from "@/lib/prisma";
import { sweepNotificationEvents } from "@/lib/notification-delivery";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };
export async function POST(request: Request) {
  let config: ReturnType<typeof readSweepConfig>;
  try { config = readSweepConfig(); } catch { return NextResponse.json({ error: "Notification delivery worker is not configured." }, { status: 503, headers }); }
  const expected = createHash("sha256").update(`Bearer ${config.CHECKOUT_SWEEP_SECRET}`).digest(), supplied = createHash("sha256").update(request.headers.get("authorization") ?? "").digest();
  if (!timingSafeEqual(expected, supplied)) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const [actual] = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
    if (actual.name !== config.CHECKOUT_SWEEP_DATABASE) return NextResponse.json({ error: "Notification database does not match the configured target." }, { status: 503, headers });
    return NextResponse.json(await sweepNotificationEvents(10), { headers });
  } catch { return NextResponse.json({ error: "Notification delivery could not be confirmed; durable events remain available." }, { status: 503, headers }); }
}
