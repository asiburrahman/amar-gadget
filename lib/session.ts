import "server-only";

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyJwtToken } from "@/lib/auth";

export type AuthenticatedUser = {
  id: string;
  email: string;
  role: string;
  sellerStatus: string;
};

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const token = (await cookies()).get("auth_token")?.value;
  if (!token) return null;

  const payload = await verifyJwtToken(token);
  if (typeof payload?.sub !== "string") return null;

  return prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      email: true,
      role: true,
      sellerStatus: true,
    },
  });
}

export async function getCurrentUserWithRole(allowedRoles: string[]) {
  const user = await getCurrentUser();
  if (!user || !allowedRoles.includes(user.role.toUpperCase())) return null;
  return user;
}
