import { NextRequest, NextResponse } from "next/server";
import { getCatalogListing, CatalogQueryError } from "@/lib/catalog-listing";
import { catalogQueryValues } from "@/lib/validations/catalog-query";

export async function GET(req: NextRequest) {
  try {
    const result = await getCatalogListing(catalogQueryValues(new URL(req.url).searchParams));
    return NextResponse.json({ success: true, ...result, message: result.brandFilter.state === "missing" ? "Brand not found." : result.categoryFilter.state === "missing" ? "Category not found." : undefined });
  } catch (error) {
    if (error instanceof CatalogQueryError) return NextResponse.json({ success: false, message: error.message, code: error.code, products: [], total: 0 }, { status: 400 });
    console.error("Public catalog query unavailable.");
    return NextResponse.json({ success: false, message: "Products are temporarily unavailable. Try again later.", products: [] }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
