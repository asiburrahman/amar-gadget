import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const brands = await prisma.brand.findMany({
      select: { id: true, name: true, slug: true, logo: true },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ success: true, brands });
  } catch (error) {
    console.error("Brand listing failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load brands." }, { status: 500 });
  }
}
