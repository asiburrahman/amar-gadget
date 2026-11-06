import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { getCurrentUserWithRole } from "@/lib/session";
import { AccountRequestError, readAccountJson, limitAccountIdentity, limitAccountIp } from "@/lib/account-request";
import { BannerError, mutateBanner, readBanners } from "@/lib/admin-banners";
import { ProductMediaError } from "@/lib/cloudflare/r2";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
async function actor(request: Request, write = false) {
  await limitAccountIp(request, write ? "banner-write" : "banner-read", write ? 60 : 120);
  const current = await getCurrentUserWithRole(["ADMIN"]);
  if (!current) throw new BannerError("Administrator access is required.", "FORBIDDEN", 403);
  if (request.headers.get("x-banner-owner") !== current.id) throw new BannerError("The active account changed. Reload this administrator area.", "BANNER_ACCOUNT_CHANGED");
  await limitAccountIdentity(current.id, write ? "banner-write" : "banner-read", write ? 40 : 120, 60);
  return current;
}
function failure(error: unknown) {
  if (error instanceof BannerError || error instanceof AccountRequestError) return NextResponse.json({ success: false, message: error.message, code: error instanceof BannerError ? error.code : "BANNER_REQUEST" }, { status: error.status, headers: { ...headers, ...(error instanceof AccountRequestError && error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
  if (error instanceof ProductMediaError) return NextResponse.json({ success: false, message: error.message, code: "BANNER_IMAGE" }, { status: 400, headers });
  if (error instanceof ZodError) return NextResponse.json({ success: false, message: "Check the banner fields, placement, position, uploaded image, request identity and revision.", code: "BANNER_REQUEST" }, { status: 400, headers });
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ success: false, message: "This request identity conflicts with saved state. Reload its receipt before retrying.", code: "BANNER_CONFLICT" }, { status: 409, headers });
  console.error("Banner operation unavailable; private request and database details were not logged.");
  return NextResponse.json({ success: false, message: "The change was not confirmed. Reload the saved state and original request receipt before retrying.", code: "BANNER_UNAVAILABLE" }, { status: 503, headers });
}
export async function GET(request: Request) {
  try {
    const current = await actor(request), params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => params.getAll(key).length !== 1)) throw new BannerError("Use each query field once.", "BANNER_REQUEST", 400);
    return NextResponse.json({ success: true, ...await readBanners(current, Object.fromEntries(params)) }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const current = await actor(request, true), result = await mutateBanner(current, await readAccountJson(request, 16_384));
    try { for (const path of ["/admin/banners", "/"]) revalidatePath(path); }
    catch { console.warn("Banner committed; cache refresh deferred."); }
    return NextResponse.json({ success: true, ownerId: current.id, ...result }, { headers });
  } catch (error) { return failure(error); }
}
