import { NextResponse } from "next/server";
import { z } from "zod";
import { listAdminSiteArticles } from "@/lib/site-content";
import { siteContentActor, siteContentFailure, siteContentHeaders, siteContentQuery } from "@/lib/site-content-request";

const querySchema = z.object({ page: z.coerce.number().int().min(1).max(1_000_000).default(1) }).strict();

export async function GET(request: Request) {
  try {
    const actor = await siteContentActor(request);
    const query = querySchema.parse(siteContentQuery(request));
    return NextResponse.json({ success: true, ...await listAdminSiteArticles(actor, query.page) }, { headers: siteContentHeaders });
  } catch (error) { return siteContentFailure(error); }
}
