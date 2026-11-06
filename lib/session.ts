import "server-only";

import { cookies } from "next/headers";
import { validateSessionToken } from "@/lib/session-validation";

export type AuthenticatedUser = {
  id: string;
  email: string;
  role: string;
  sellerStatus: string;
  sessionVersion: number;
};

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const token = (await cookies()).get("auth_token")?.value;
  if (!token) return null;

  return validateSessionToken(token);
}

export async function getCurrentUserWithRole(allowedRoles: string[]) {
  const user = await getCurrentUser();
  if (!user || !allowedRoles.includes(user.role.toUpperCase())) return null;
  return user;
}
