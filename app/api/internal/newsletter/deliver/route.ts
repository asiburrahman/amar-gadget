import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { readSweepConfig } from "@/config/runtime";
import { prisma } from "@/lib/prisma";
import { sweepNewsletterDeliveries } from "@/lib/newsletter";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };
export async function POST(request: Request) {
  let config: ReturnType<typeof readSweepConfig>;
  try { config = readSweepConfig(); } catch { return NextResponse.json({ error: "Newsletter worker configuration is unavailable." }, { status: 503, headers }); }
  const expected = createHash("sha256").update(`Bearer ${config.CHECKOUT_SWEEP_SECRET}`).digest(), supplied = createHash("sha256").update(request.headers.get("authorization") ?? "").digest();
  if (!timingSafeEqual(expected, supplied)) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const [actual] = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
    if (actual.name !== config.CHECKOUT_SWEEP_DATABASE) return NextResponse.json({ error: "Newsletter worker database target does not match." }, { status: 503, headers });
    // One SMTP attempt per invocation: other workers/web requests keep their
    // own leases, and no unbounded recipient list is sent by this endpoint.
    return NextResponse.json(await sweepNewsletterDeliveries(1), { headers });
  } catch { return NextResponse.json({ error: "Newsletter delivery could not be confirmed. Durable requests are retained." }, { status: 503, headers }); }
}
