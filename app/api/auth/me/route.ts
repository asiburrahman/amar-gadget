import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { validateSessionToken } from "@/lib/session-validation";
import { prisma } from "@/lib/prisma";
import { accountWithSafeAvatar } from "@/lib/avatar-policy";
import { unavailableResponse } from "@/lib/http-unavailable";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value;

    if (!token) {
      return NextResponse.json({ success: false, user: null }, { headers: privateHeaders });
    }

    const account = await validateSessionToken(token);
    const payload = account ? { sub: account.id } : null;
    if (!payload || !payload.sub) {
      return NextResponse.json({ success: false, user: null }, { headers: privateHeaders });
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
        sessionVersion: true,
      },
    });

    if (!user || !account || !user.isVerified || user.sessionVersion !== account.sessionVersion || user.role !== account.role || user.email !== account.email) {
      return NextResponse.json({ success: false, user: null }, { headers: privateHeaders });
    }

    const { sessionVersion: _version, ...profile } = user; void _version;
    return NextResponse.json({ success: true, user: accountWithSafeAvatar(profile) }, { headers: privateHeaders });
  } catch (error) {
    return unavailableResponse("auth.profile", error, "Your session could not be verified. Retry shortly.");
  }
}
