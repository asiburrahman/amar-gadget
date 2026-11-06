import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { getCurrentUserWithRole } from "@/lib/session";
import { AccountRequestError, readAccountJson, limitAccountIdentity, limitAccountIp } from "@/lib/account-request";
import { mutateTaxonomy, readTaxonomy, TaxonomyError } from "@/lib/catalog-taxonomy";
import { ProductMediaError } from "@/lib/cloudflare/r2";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
async function actor(request: Request, write = false) {
  await limitAccountIp(request, write ? "taxonomy-write" : "taxonomy-read", write ? 40 : 120);
  const current = await getCurrentUserWithRole(["ADMIN"]);
  if (!current) throw new TaxonomyError("Administrator access is required.", "FORBIDDEN", 403);
  if (request.headers.get("x-taxonomy-owner") !== current.id) throw new TaxonomyError("The active account changed. Reload this administrator area.", "TAXONOMY_ACCOUNT_CHANGED");
  await limitAccountIdentity(current.id, write ? "taxonomy-write" : "taxonomy-read", write ? 20 : 120, 60);
  return current;
}
function failure(error: unknown) {
  if (error instanceof TaxonomyError || error instanceof AccountRequestError) return NextResponse.json({ success: false, message: error.message, code: error instanceof TaxonomyError ? error.code : "TAXONOMY_REQUEST" }, { status: error.status, headers: { ...headers, ...(error instanceof AccountRequestError && error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
  if (error instanceof ZodError) return NextResponse.json({ success: false, message: "Check the catalog fields, selected parent, request identity and current revision.", code: "TAXONOMY_REQUEST" }, { status: 400, headers });
  if (error instanceof ProductMediaError) return NextResponse.json({ success: false, message: error.message, code: "TAXONOMY_IMAGE" }, { status: 400, headers });
  if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2003"].includes(error.code)) return NextResponse.json({ success: false, message: error.code === "P2002" ? "This name or URL is already used or retained by an earlier catalog URL. Choose another and reload the saved state." : "This catalog record is still referenced. Reload its product and subcategory counts.", code: "TAXONOMY_CONFLICT" }, { status: 409, headers });
  console.error("Taxonomy operation unavailable; storage, credentials and private details were not logged.");
  return NextResponse.json({ success: false, message: "The change was not confirmed. Reload the saved catalog and original request receipt before retrying.", code: "TAXONOMY_UNAVAILABLE" }, { status: 503, headers });
}
export async function GET(request: Request) {
  try {
    const current = await actor(request), params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => params.getAll(key).length !== 1)) throw new TaxonomyError("Use each catalog query field once.", "TAXONOMY_REQUEST", 400);
    return NextResponse.json({ success: true, ...await readTaxonomy(current, Object.fromEntries(params)) }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const current = await actor(request, true), result = await mutateTaxonomy(current, await readAccountJson(request, 16_384));
    try { revalidatePath("/", "layout"); } catch { console.warn("Catalog change committed; cache refresh deferred."); }
    return NextResponse.json({ success: true, ownerId: current.id, result }, { headers });
  } catch (error) { return failure(error); }
}
