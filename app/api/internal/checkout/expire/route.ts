import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sweepReservations } from "@/lib/checkout-reservations";
import { prisma } from "@/lib/prisma";
import { readSweepConfig } from "@/config/runtime";

export const maxDuration = 60;

export async function POST(req: Request) {
  let config: ReturnType<typeof readSweepConfig>;
  try { config = readSweepConfig(); }
  catch { return NextResponse.json({ error: "Reservation worker is not configured" }, { status: 503 }); }
  const { CHECKOUT_SWEEP_SECRET: secret, CHECKOUT_SWEEP_DATABASE: database } = config;
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  const supplied = createHash("sha256").update(req.headers.get("authorization") ?? "").digest();
  if (!timingSafeEqual(expected, supplied)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const [actual] = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
    if (actual.name !== database) return NextResponse.json({ error: "Reservation database does not match configured target" }, { status: 503 });
    return NextResponse.json({ database, ...await sweepReservations() });
  }
  catch { return NextResponse.json({ error: "Reservation sweep failed" }, { status: 503 }); }
}
