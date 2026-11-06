import { NextResponse } from "next/server";
import { z } from "zod";
import { readAccountJson } from "@/lib/account-request";
import { readSupportContactSettings, saveSupportContactSettings } from "@/lib/support-contact";
import { supportActor, supportFailure, supportHeaders, supportJsonContent, supportQuery } from "@/lib/support-request";

export async function GET(request: Request) {
  try {
    const actor = await supportActor(request), query = z.object({ page: z.coerce.number().int().min(1).max(1_000_000).default(1) }).strict().parse(supportQuery(request));
    return NextResponse.json({ success: true, ...await readSupportContactSettings(actor, query.page) }, { headers: supportHeaders });
  } catch (error) { return supportFailure(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await supportActor(request, true); z.object({}).strict().parse(supportQuery(request)); supportJsonContent(request);
    return NextResponse.json({ success: true, ...await saveSupportContactSettings(actor, await readAccountJson(request, 8192)) }, { headers: supportHeaders });
  } catch (error) { return supportFailure(error); }
}
