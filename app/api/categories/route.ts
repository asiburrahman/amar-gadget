import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const categories = await prisma.category.findMany({
      select: { id: true, name: true, slug: true, image: true },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ success: true, categories });
  } catch (error) {
    console.error("Category listing failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load categories." }, { status: 500 });
  }
}
