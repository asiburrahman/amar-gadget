import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserWithRole } from "@/lib/session";
import { generatePresignedUploadUrl } from "@/lib/cloudflare/r2";

const uploadSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  size: z.number().int().positive().max(10 * 1024 * 1024),
});

export async function POST(req: Request) {
  const user = await getCurrentUserWithRole(["ADMIN", "MEMBER"]);
  if (!user || (user.role.toUpperCase() === "MEMBER" && user.sellerStatus !== "APPROVED")) {
    return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
  }

  const parsed = uploadSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, message: "Invalid upload request." }, { status: 400 });
  }

  try {
    const result = await generatePresignedUploadUrl({
      filename: parsed.data.filename,
      contentType: parsed.data.contentType,
      maxSizeInBytes: parsed.data.size,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Upload URL generation failed:", error);
    return NextResponse.json(
      { success: false, message: "Unable to prepare the upload." },
      { status: 503 }
    );
  }
}
