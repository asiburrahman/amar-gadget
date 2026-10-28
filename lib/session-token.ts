import { SignJWT, jwtVerify } from "jose";

function secretKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error("JWT_SECRET requires at least 32 bytes.");
  return new TextEncoder().encode(secret);
}
type TokenAccount = { id: string; email: string; name?: string | null; role: string; sessionVersion: number };

export async function signJwtToken(user: TokenAccount): Promise<string> {
  if (!Number.isSafeInteger(user.sessionVersion) || user.sessionVersion < 0) throw new Error("A valid account session version is required.");
  return new SignJWT({ sub: user.id, email: user.email, name: user.name || "", role: user.role, sessionVersion: user.sessionVersion })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" }).setIssuedAt().setExpirationTime("7d").sign(secretKey());
}

/** Signature/shape only. Protected data must also use validateSessionToken. */
export async function verifyJwtToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"], requiredClaims: ["sub", "iat", "exp"] });
    if (typeof payload.sub !== "string" || !payload.sub || typeof payload.email !== "string" || typeof payload.role !== "string" || !Number.isSafeInteger(payload.sessionVersion) || (payload.sessionVersion as number) < 0) return null;
    return { ...payload, sub: payload.sub, email: payload.email, role: payload.role, sessionVersion: payload.sessionVersion as number };
  } catch { return null; }
}
