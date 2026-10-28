import { prisma } from "@/lib/prisma";
import { verifyJwtToken } from "@/lib/session-token";

/** Fresh database authority for every protected read/action. No shared cache. */
export async function validateSessionToken(token: string) {
  const payload = await verifyJwtToken(token);
  if (!payload) return null;
  const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, email: true, role: true, sellerStatus: true, isVerified: true, sessionVersion: true } });
  if (!user || !user.isVerified || user.sessionVersion !== payload.sessionVersion || user.email !== payload.email || user.role !== payload.role) return null;
  return user;
}
