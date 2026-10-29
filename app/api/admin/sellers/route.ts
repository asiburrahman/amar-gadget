import { NextResponse } from "next/server";
import { getCurrentUserWithRole } from "@/lib/session";
import { sellerStatusUpdateSchema } from "@/lib/validations/product";
import { updateSellerStatus } from "@/server/actions/admin/admin-actions";
import { readAccountJson, AccountRequestError } from "@/lib/account-request";

export async function POST(req: Request) {
  try {
    if (!(await getCurrentUserWithRole(["ADMIN"]))) return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    const parsed = sellerStatusUpdateSchema.safeParse(await readAccountJson(req, 2048));
    if (!parsed.success) return NextResponse.json({ success: false, message: "Invalid seller status update." }, { status: 400 });
    const result = await updateSellerStatus(parsed.data.sellerId, parsed.data.sellerStatus);
    if (!result.success) return NextResponse.json({ success: false, message: result.error }, { status: result.error === "Unauthorized" ? 401 : result.error === "Seller not found." ? 404 : 409 });
    return NextResponse.json({ success: true, user: result.data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AccountRequestError) return NextResponse.json({ success: false, message: error.message }, { status: error.status });
    console.error("Seller management is temporarily unavailable.");
    return NextResponse.json({ success: false, message: "Seller management is temporarily unavailable. Try again later." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
