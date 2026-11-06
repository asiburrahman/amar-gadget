import { NextResponse } from "next/server";
import { z } from "zod";
import { readAccountJson } from "@/lib/account-request";
import { readSupportQueue, readSupportMessage, mutateSupportStatus } from "@/lib/support";
import { supportActor, supportFailure, supportHeaders, supportJsonContent, supportQuery } from "@/lib/support-request";

const detailQuery = z.object({ id: z.string().uuid(), eventPage: z.coerce.number().int().min(1).max(1_000_000).default(1) }).strict();
export async function GET(request: Request) {
  try {
    const actor = await supportActor(request), query = supportQuery(request);
    if ("id" in query) {
      const parsed = detailQuery.parse(query);
      return NextResponse.json({ success: true, ...await readSupportMessage(actor, parsed.id, parsed.eventPage) }, { headers: supportHeaders });
    }
    return NextResponse.json({ success: true, ...await readSupportQueue(actor, query) }, { headers: supportHeaders });
  } catch (error) { return supportFailure(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await supportActor(request, true);
    z.object({}).strict().parse(supportQuery(request)); supportJsonContent(request);
    return NextResponse.json({ success: true, ...await mutateSupportStatus(actor, await readAccountJson(request, 4096)) }, { headers: supportHeaders });
  } catch (error) { return supportFailure(error); }
}
