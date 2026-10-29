import { NextResponse } from "next/server";
import { z } from "zod";
import { getCatalogOptions } from "@/lib/catalog-options";
import { limitAccountIp, AccountRequestError } from "@/lib/account-request";
import { catalogQueryValues } from "@/lib/validations/catalog-query";

const schema = z.object({ kind: z.enum(["brand", "category"]), search: z.string().trim().max(120).refine((value) => !/[\u0000-\u001f\u007f]/.test(value)).default(""), page: z.string().regex(/^\d{1,7}$/).transform(Number).pipe(z.number().int().min(1).max(1_000_000)).default(1) });
export async function GET(request: Request) {
  try {
    const parsed = schema.safeParse(catalogQueryValues(new URL(request.url).searchParams));
    if (!parsed.success) return NextResponse.json({ success: false, message: "Invalid catalog options request." }, { status: 400 });
    await limitAccountIp(request, "catalog-options", 60);
    return NextResponse.json({ success: true, ...await getCatalogOptions(parsed.data.kind, parsed.data.search, parsed.data.page) });
  } catch (error) {
    if (error instanceof AccountRequestError) return NextResponse.json({ success: false, message: error.message }, { status: error.status, headers: { "Retry-After": "60" } });
    console.error("Catalog options are unavailable.");
    return NextResponse.json({ success: false, message: "Options are temporarily unavailable. Retry shortly." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
