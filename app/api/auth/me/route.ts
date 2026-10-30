import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { validateSessionToken } from "@/lib/session-validation";
import { prisma } from "@/lib/prisma";
import { accountWithSafeAvatar } from "@/lib/avatar-policy";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value;

    if (!token) {
      return NextResponse.json({ success: false, user: null });
    }

    const account = await validateSessionToken(token);
    const payload = account ? { sub: account.id } : null;
    if (!payload || !payload.sub) {
      return NextResponse.json({ success: false, user: null });
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub as string },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatar: true,
        avatarKey: true,
        avatarVersion: true,
        phone: true,
        isVerified: true,
        sellerStatus: true,
      },
    });

    if (!user) {
      return NextResponse.json({ success: false, user: null });
    }

    const res = NextResponse.json({ success: true, user: accountWithSafeAvatar(user) });
    res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    return res;
  } catch {
    return NextResponse.json({ success: false, user: null });
  }
}
