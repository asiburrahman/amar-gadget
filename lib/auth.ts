import { SignJWT, jwtVerify } from "jose";
export { hashPassword, verifyPassword, passwordNeedsRehash, PasswordWorkloadBusy } from "@/lib/password";

function getJwtSecretKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be configured with at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

/**
 * Cryptographically signs a JWT token using jose HS256 for edge compatibility.
 */
export async function signJwtToken(user: {
  id: string;
  email: string;
  name?: string | null;
  role: string;
}): Promise<string> {
  return await new SignJWT({
    sub: user.id,
    email: user.email,
    name: user.name || "",
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getJwtSecretKey());
}

/**
 * Verifies and decodes a signed JWT token.
 */
export async function verifyJwtToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, getJwtSecretKey());
    return payload;
  } catch {
    return null;
  }
}
