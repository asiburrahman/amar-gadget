import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserWithRole } from "@/lib/session";
import { generatePresignedUploadUrl } from "@/lib/cloudflare/r2";
import { readAccountJson, limitAccountIp, limitAccountIdentity, accountErrorResponse } from "@/lib/account-request";
import { PRODUCT_IMAGE_TYPES, MAX_PRODUCT_IMAGE_BYTES } from "@/lib/product-media-policy";

const uploadSchema = z.object({ contentType: z.enum(PRODUCT_IMAGE_TYPES), size: z.number().int().positive().max(MAX_PRODUCT_IMAGE_BYTES) }).strict();

export async function POST(req: Request) {
  try {
    const user = await getCurrentUserWithRole(["ADMIN", "MEMBER"]);
    if (!user) return NextResponse.json({ success: false, message: "Sign in to upload images." }, { status: 401 });
    if (user.role.toUpperCase() === "MEMBER" && user.sellerStatus !== "APPROVED") return NextResponse.json({ success: false, message: "Seller approval is required." }, { status: 403 });
    await limitAccountIp(req, "product-upload", 40);
    await limitAccountIdentity(user.id, "product-upload", 40, 60);
    const parsed = uploadSchema.safeParse(await readAccountJson(req, 1024));
    if (!parsed.success) return NextResponse.json({ success: false, message: "Choose a JPEG, PNG or WebP image up to 5 MiB." }, { status: 400 });
    const result = await generatePresignedUploadUrl({ ownerId: user.id, ...parsed.data });
    return NextResponse.json({ success: true, ...result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = accountErrorResponse(error);
    if (response.status < 500) return response;
    console.error("Product upload preparation unavailable.");
    return NextResponse.json({ success: false, message: "Storage is unavailable. Try again later." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
