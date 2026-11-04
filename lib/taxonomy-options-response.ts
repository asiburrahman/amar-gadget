import { NextResponse } from "next/server";
import { publicTaxonomyQuerySchema } from "@/lib/validations/collection-query";
import { catalogQueryValues } from "@/lib/validations/catalog-query";
import { readTaxonomyOptions } from "@/lib/taxonomy-options";
import { limitAccountIp, AccountRequestError } from "@/lib/account-request";
import { unavailableResponse } from "@/lib/http-unavailable";
export async function taxonomyOptionsResponse(kind: "category" | "brand", request: Request) {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const parsed = publicTaxonomyQuerySchema.safeParse(catalogQueryValues(new URL(request.url).searchParams));
    if (!parsed.success) return NextResponse.json({ success: false, message: "Invalid taxonomy search or page." }, { status: 400, headers });
    await limitAccountIp(request, "taxonomy-options", 60);
    const { items, ...pagination } = await readTaxonomyOptions(kind, parsed.data);
    return NextResponse.json({ success: true, [kind === "category" ? "categories" : "brands"]: items, pagination }, { headers });
  } catch (error) {
    if (error instanceof AccountRequestError) return NextResponse.json({ success: false, message: error.message }, { status: error.status, headers: { ...headers, "Retry-After": String(error.retryAfter ?? 60) } });
    return unavailableResponse(kind === "category" ? "taxonomy.categories" : "taxonomy.brands", error, "Taxonomy choices are temporarily unavailable. Retry shortly.");
  }
}
