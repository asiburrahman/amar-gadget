import { NextResponse } from "next/server";
import { z } from "zod";
import { readAccountJson } from "@/lib/account-request";
import { mutateSiteContent, readAdminSiteContent, readAdminSiteContentRevision } from "@/lib/site-content";
import { siteContentActor, siteContentFailure, siteContentHeaders, siteContentJson, siteContentQuery } from "@/lib/site-content-request";
import { SITE_CONTENT_KINDS, siteContentAddressSchema } from "@/lib/validations/site-content";

const querySchema = z.object({
  kind: z.enum(SITE_CONTENT_KINDS), slug: z.string().min(1).max(100),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  revision: z.coerce.number().int().min(1).max(2_147_483_647).optional(),
}).strict().refine((query) => !query.revision || query.page === 1, "Request either a revision or a history page.");

export async function GET(request: Request) {
  try {
    const actor = await siteContentActor(request), query = querySchema.parse(siteContentQuery(request));
    const address = siteContentAddressSchema.parse({ kind: query.kind, slug: query.slug });
    const view = query.revision ? await readAdminSiteContentRevision(actor, address, query.revision) : await readAdminSiteContent(actor, address, query.page);
    return NextResponse.json({ success: true, ...view }, { headers: siteContentHeaders });
  } catch (error) { return siteContentFailure(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await siteContentActor(request, true);
    z.object({}).strict().parse(siteContentQuery(request)); siteContentJson(request);
    return NextResponse.json({ success: true, ...await mutateSiteContent(actor, await readAccountJson(request, 128 * 1024)) }, { headers: siteContentHeaders });
  } catch (error) { return siteContentFailure(error); }
}
