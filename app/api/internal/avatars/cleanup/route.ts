import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { readMediaCleanupConfig } from "@/config/runtime";
import { prisma } from "@/lib/prisma";
import { avatarMediaStore } from "@/lib/cloudflare/avatar-store";
import { processAvatarCleanupJobs } from "@/lib/avatar-cleanup";
export const maxDuration = 60;
export async function POST(request: Request) {
  let config: ReturnType<typeof readMediaCleanupConfig>;
  try { config = readMediaCleanupConfig(); } catch { return NextResponse.json({ error: "Avatar cleanup worker is not configured." }, { status: 503 }); }
  const expected = createHash("sha256").update(`Bearer ${config.CHECKOUT_SWEEP_SECRET}`).digest();
  const supplied = createHash("sha256").update(request.headers.get("authorization") ?? "").digest();
  if (!timingSafeEqual(expected, supplied)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const [actual] = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
    if (actual.name !== config.MEDIA_CLEANUP_DATABASE) return NextResponse.json({ error: "Avatar cleanup database does not match configured target." }, { status: 503 });
    return NextResponse.json(await processAvatarCleanupJobs(prisma, avatarMediaStore(), { apply: true, limit: 2 }), { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Avatar cleanup failed; pending jobs remain available for retry." }, { status: 503 }); }
}
