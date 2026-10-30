import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { validateSessionToken } from "@/lib/session-validation";
import { prisma } from "@/lib/prisma";
import { profileUpdateSchema } from "@/lib/validations/auth";
import { readAccountJson, limitAccountIp, limitAccountIdentity, accountErrorResponse, AccountRequestError } from "@/lib/account-request";
import { MAX_SAVED_ADDRESSES } from "@/lib/validations/address";
import { accountWithSafeAvatar } from "@/lib/avatar-policy";
import { avatarUserSelect, updateProfileAvatarReference } from "@/lib/avatars";
import { AvatarError } from "@/lib/avatar-image";
import { avatarFailure, avatarPrivateHeaders } from "@/lib/avatar-request";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value;

    if (!token) {
      return NextResponse.json(
        { success: false, message: "Unauthorized. Please sign in." },
        { status: 401 }
      );
    }

    const account = await validateSessionToken(token);
    if (req.headers.has("x-profile-owner") && req.headers.get("x-profile-owner") !== account?.id) return NextResponse.json({ success: false, message: "The active account changed. Reload your session." }, { status: 409, headers: avatarPrivateHeaders });
    const payload = account ? { sub: account.id } : null;
    if (!payload?.sub) {
      return NextResponse.json(
        { success: false, message: "Invalid session." },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub as string },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        avatar: true,
        avatarKey: true,
        avatarVersion: true,
        legacyAvatar: { select: { userId: true } },
        role: true,
        sellerStatus: true,
        isVerified: true,
        createdAt: true,
        addresses: {
          where: { isDefault: true },
          take: 1,
        },
      },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, message: "User not found." },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, user: accountWithSafeAvatar(user) }, { headers: avatarPrivateHeaders });
  } catch {
    console.error("GET /api/user/profile error:");
    return NextResponse.json(
      { success: false, message: "Failed to load profile" },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request) {
  try {
    await limitAccountIp(req, "profile-update", 60);
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value;

    if (!token) {
      return NextResponse.json(
        { success: false, message: "Unauthorized. Please sign in." },
        { status: 401 }
      );
    }

    const account = await validateSessionToken(token);
    if (req.headers.has("x-profile-owner") && req.headers.get("x-profile-owner") !== account?.id) return NextResponse.json({ success: false, message: "The active account changed. Reload your session." }, { status: 409, headers: avatarPrivateHeaders });
    const payload = account ? { sub: account.id } : null;
    if (!payload?.sub) {
      return NextResponse.json(
        { success: false, message: "Invalid session." },
        { status: 401 }
      );
    }

    await limitAccountIdentity(payload.sub, "profile-update", 30, 60);
    const parsed = profileUpdateSchema.safeParse(await readAccountJson(req));
    if (!parsed.success) return NextResponse.json({ success: false, message: "Check the profile/address fields and their length limits.", errors: parsed.error.flatten().fieldErrors }, { status: 400 });
    const { name, phone, avatar, avatarVersion, address, addressRevision } = parsed.data;
    if (avatar !== undefined && req.headers.get("x-avatar-owner") !== account?.id) throw new AvatarError("The active account changed. Reload your session.", "AVATAR_ACCOUNT_CHANGED", 409);

    const userId = payload.sub as string;

    const updatedUser = await prisma.$transaction(async (tx) => {
      // Lock order matches credential/OTP writers. Recheck session authority
      // after acquiring the lock, before either half of this mutation.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const current = await tx.user.findUnique({ where: { id: userId }, select: { ...avatarUserSelect, role: true, sessionVersion: true, isVerified: true } });
      if (!current?.isVerified || current.role !== account?.role || current.sessionVersion !== account?.sessionVersion) return null;
      const changes = {
        ...(name !== undefined ? { name } : {}),
        ...(phone !== undefined ? { phone } : {}),
      };
      if (Object.keys(changes).length) await tx.user.update({ where: { id: userId }, data: changes });
      if (avatar !== undefined && avatarVersion !== undefined) await updateProfileAvatarReference(tx, current, avatar, avatarVersion);
      if (address) {
        const existing = await tx.address.findFirst({ where: { userId, isDefault: true }, select: { id: true, version: true } });
        if (addressRevision !== undefined && (addressRevision === null ? Boolean(existing) : !existing || existing.id !== addressRevision.id || existing.version !== addressRevision.version)) throw new AccountRequestError("Your default address changed. Reload your profile before saving.", 409);
        const data = { ...address, zipCode: address.zipCode || null };
        if (existing) await tx.address.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } });
        else {
          if (await tx.address.count({ where: { userId } }) >= MAX_SAVED_ADDRESSES) throw new AccountRequestError("You already have 20 saved addresses. Choose an existing default on the addresses page.", 409);
          await tx.address.create({ data: { ...data, userId, isDefault: true } });
        }
      }
      return tx.user.findUniqueOrThrow({ where: { id: userId }, select: {
        ...avatarUserSelect, name: true, email: true, phone: true, role: true,
        legacyAvatar: { select: { userId: true } },
        sellerStatus: true, isVerified: true, createdAt: true,
        addresses: { where: { isDefault: true }, take: 1 },
      } });
    });
    if (!updatedUser) return NextResponse.json({ success: false, message: "Your account changed. Sign in again before saving." }, { status: 409 });

    return NextResponse.json({
      success: true,
      message: "Profile updated successfully!",
      user: accountWithSafeAvatar(updatedUser),
    }, { headers: avatarPrivateHeaders });
  } catch (error) { return error instanceof AvatarError ? avatarFailure(error) : accountErrorResponse(error); }
}
