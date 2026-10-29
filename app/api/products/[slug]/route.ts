import { NextResponse } from "next/server";
import { getPublicProduct } from "@/lib/public-product";
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const product = await getPublicProduct((await params).slug);
    return product ? NextResponse.json({ success: true, product: { ...product, price: Number(product.price), discountPrice: product.discountPrice === null ? null : Number(product.discountPrice) } }) : NextResponse.json({ success: false, message: "Product not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ success: false, message: "Product temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
