import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { getCurrentUserWithRole } from "@/lib/session";
import { AccountRequestError, readAccountJson, limitAccountIdentity, limitAccountIp } from "@/lib/account-request";
import { AccountAdminError, mutateAccountAdministration, readAccountAdministration } from "@/lib/account-administration";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
async function actor(request: Request, write = false) {
  await limitAccountIp(request, write ? "admin-account-write" : "admin-account-read", write ? 30 : 120);
  const current = await getCurrentUserWithRole(["ADMIN"]);
  if (!current) throw new AccountAdminError("Administrator access is required.", "FORBIDDEN", 403);
  if (request.headers.get("x-account-owner") !== current.id) throw new AccountAdminError("The active account changed. Reload this administrator area.", "ADMIN_OWNER_CHANGED");
  await limitAccountIdentity(current.id, write ? "admin-account-write" : "admin-account-read", write ? 20 : 120, 60); return current;
}
function failure(error: unknown) {
  if (error instanceof AccountAdminError || error instanceof AccountRequestError) return NextResponse.json({ success: false, message: error.message, code: error instanceof AccountAdminError ? error.code : "ADMIN_REQUEST" }, { status: error.status, headers: { ...headers, ...(error instanceof AccountRequestError && error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
  if (error instanceof ZodError) return NextResponse.json({ success: false, message: "Check the account, current revision, confirmed action, reason and request identity.", code: "ADMIN_REQUEST" }, { status: 400, headers });
  console.error("Account administration unavailable; private request and database details were not logged.");
  return NextResponse.json({ success: false, message: "The change was not confirmed. Reload saved account state and its original request receipt before retrying.", code: "ADMIN_UNAVAILABLE" }, { status: 503, headers });
}
export async function GET(request: Request) {
  try {
    const current = await actor(request), params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => params.getAll(key).length !== 1)) throw new AccountAdminError("Use each query field once.", "ADMIN_REQUEST", 400);
    return NextResponse.json({ success: true, ...await readAccountAdministration(current, Object.fromEntries(params)) }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const current = await actor(request, true), result = await mutateAccountAdministration(current, await readAccountJson(request, 8192));
    try { revalidatePath("/", "layout"); } catch { console.warn("Account administration committed; cache refresh deferred."); }
    return NextResponse.json({ success: true, ownerId: current.id, ...result }, { headers });
  } catch (error) { return failure(error); }
}
