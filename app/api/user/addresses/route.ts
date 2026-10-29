import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { AccountRequestError, accountErrorResponse, limitAccountIdentity, limitAccountIp, readAccountJson } from "@/lib/account-request";
import { addressPageSchema, addressRevisionSchema, createAddressSchema, updateAddressSchema } from "@/lib/validations/address";
import { createAddress, listAddresses, mutateAddress } from "@/lib/addresses";
export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store" };
async function actor(request: Request, write = false) {
  const operation = write ? "saved-addresses-write" : "saved-addresses-read";
  await limitAccountIp(request, operation, write ? 60 : 120);
  const user = await getCurrentUser();
  if (!user) throw new AccountRequestError("Sign in to manage saved addresses.", 401);
  await limitAccountIdentity(user.id, operation, write ? 30 : 120, 60);
  return user;
}
function failure(error: unknown) {
  if (!(error instanceof AccountRequestError)) {
    console.error("Saved address request unavailable; private details were not logged.");
    return NextResponse.json({ success: false, message: "Saved addresses are temporarily unavailable. Reload before retrying an uncertain save." }, { status: 503, headers: privateHeaders });
  }
  const response = accountErrorResponse(error); response.headers.set("Cache-Control", "private, no-store"); return response;
}
export async function GET(request: Request) {
  try {
    const user = await actor(request), query = new URL(request.url).searchParams;
    const page = addressPageSchema.safeParse(query.get("page"));
    if (!page.success || [...query.keys()].some((key) => key !== "page") || query.getAll("page").length > 1) throw new AccountRequestError("Invalid address page.", 400);
    return NextResponse.json({ success: true, ...await listAddresses(user, page.data) }, { headers: privateHeaders });
  } catch (error) { return failure(error); }
}
async function write(request: Request, method: "POST" | "PUT" | "PATCH" | "DELETE") {
  try {
    const user = await actor(request, true), body = await readAccountJson(request, 4096);
    if (method === "POST") {
      const parsed = createAddressSchema.safeParse(body);
      if (!parsed.success) throw new AccountRequestError(parsed.error.issues[0]?.message ?? "Check the address fields.", 400);
      return NextResponse.json({ success: true, address: await createAddress(user, parsed.data.fields, parsed.data.makeDefault) }, { status: 201, headers: privateHeaders });
    }
    if (method === "PUT") {
      const parsed = updateAddressSchema.safeParse(body);
      if (!parsed.success) throw new AccountRequestError("Check the address fields and revision.", 400);
      return NextResponse.json({ success: true, address: await mutateAddress(user, parsed.data, "update", parsed.data.fields) }, { headers: privateHeaders });
    }
    const parsed = addressRevisionSchema.safeParse(body);
    if (!parsed.success) throw new AccountRequestError("Provide a valid saved address revision.", 400);
    return NextResponse.json({ success: true, address: await mutateAddress(user, parsed.data, method === "PATCH" ? "default" : "delete") }, { headers: privateHeaders });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) { return write(request, "POST"); }
export async function PUT(request: Request) { return write(request, "PUT"); }
export async function PATCH(request: Request) { return write(request, "PATCH"); }
export async function DELETE(request: Request) { return write(request, "DELETE"); }
