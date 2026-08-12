import crypto from "crypto";
import { SignJWT, jwtVerify } from "jose";

const JWT_SECRET_KEY = new TextEncoder().encode(
  process.env.JWT_SECRET || "fallback-secret-for-build-purposes-only-32chars"
);

/**
 * Hashes a plain-text password using PBKDF2 with SHA-512 and a random 16-byte salt.
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

/**
 * Verifies a plain-text password against a stored PBKDF2 salt:hash string.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash || !storedHash.includes(":")) return false;
  const [salt, originalHash] = storedHash.split(":");
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
  return hash === originalHash;
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
    .sign(JWT_SECRET_KEY);
}

/**
 * Verifies and decodes a signed JWT token.
 */
export async function verifyJwtToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET_KEY);
    return payload;
  } catch (error) {
    return null;
  }
}
