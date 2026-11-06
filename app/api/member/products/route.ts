import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { getCurrentUserWithRole } from "@/lib/session";
import { AccountRequestError, readAccountJson, limitAccountIdentity, limitAccountIp } from "@/lib/account-request";
import { ProductMaintenanceError, readProductMaintenance, mutateProductMaintenance } from "@/lib/product-maintenance";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
async function actor(request: Request, write = false) {
  await limitAccountIp(request, write ? "seller-catalog-write" : "seller-catalog-read", write ? 40 : 120);
  const current = await getCurrentUserWithRole(["MEMBER", "ADMIN"]);
  if (!current) throw new ProductMaintenanceError("Approved catalog-owner access is required.", "FORBIDDEN", 403);
  if (request.headers.get("x-product-owner") !== current.id) throw new ProductMaintenanceError("The active account changed. Reload your catalog.", "PRODUCT_OWNER_CHANGED");
  await limitAccountIdentity(current.id, write ? "seller-catalog-write" : "seller-catalog-read", write ? 20 : 120, 60); return current;
}
function failure(error: unknown) {
  if (error instanceof ProductMaintenanceError || error instanceof AccountRequestError) return NextResponse.json({ success: false, message: error.message, code: error instanceof ProductMaintenanceError ? error.code : "PRODUCT_REQUEST" }, { status: error.status, headers: { ...headers, ...(error instanceof AccountRequestError && error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
  if (error instanceof ZodError) return NextResponse.json({ success: false, message: "Check the product fields, current revisions, inventory quantity, confirmation, reason and request identity.", code: "PRODUCT_REQUEST" }, { status: 400, headers });
  console.error("Seller catalog operation unavailable; private request and database details were not logged.");
  return NextResponse.json({ success: false, message: "The change was not confirmed. Reload your saved product and original request receipt before retrying.", code: "PRODUCT_UNAVAILABLE" }, { status: 503, headers });
}
export async function GET(request: Request) {
  try {
    const current = await actor(request), params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => params.getAll(key).length !== 1)) throw new ProductMaintenanceError("Use each catalog query field once.", "PRODUCT_REQUEST", 400);
    return NextResponse.json({ success: true, ...await readProductMaintenance(current, Object.fromEntries(params)) }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const current = await actor(request, true), result = await mutateProductMaintenance(current, await readAccountJson(request, 196_608));
    try { revalidatePath("/", "layout"); } catch { console.warn("Seller catalog change committed; cache refresh deferred."); }
    return NextResponse.json({ success: true, ownerId: current.id, ...result }, { headers });
  } catch (error) { return failure(error); }
}
