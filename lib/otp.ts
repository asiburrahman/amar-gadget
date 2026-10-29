import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { Prisma, User, OtpToken } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { readPrivateSecret } from "@/config/runtime";

export type OtpPurpose = "REGISTRATION" | "PASSWORD_RESET" | "EMAIL_CHANGE";
const PURPOSES = new Set<OtpPurpose>(["REGISTRATION", "PASSWORD_RESET", "EMAIL_CHANGE"]);
const WINDOW_MS = 10 * 60_000;
type Context = { userId: string; email: string; purpose: OtpPurpose; expectedAccountFingerprint?: string };
type VerifiedOtp = Pick<OtpToken, "id" | "userId" | "email" | "purpose" | "codeHash" | "accountFingerprint">;
const verifiedTickets = new WeakSet<VerifiedOtp>();

export class OtpError extends Error {
  constructor(message: string, readonly status = 400, readonly retryAfter?: number) { super(message); }
}

function secret() {
  try { return readPrivateSecret("OTP_SECRET"); }
  catch { throw new OtpError("Verification is temporarily unavailable.", 503); }
}
export function otpAccountFingerprint(user: Pick<User, "email" | "password" | "isVerified" | "role" | "sellerStatus"> & { sessionVersion?: number }) {
  return createHash("sha256").update(JSON.stringify(["account-otp-v1", user.email, user.password, user.isVerified, user.role, user.sellerStatus, user.sessionVersion ?? 0])).digest("hex");
}
export function otpCodeHash(context: Pick<OtpToken, "id" | "userId" | "email" | "purpose" | "accountFingerprint">, code: string) {
  return createHmac("sha256", secret()).update(JSON.stringify(["amar-gadget-otp-v1", context.id, context.userId, context.purpose, context.email, context.accountFingerprint, code])).digest("hex");
}
function normalize(context: Context): Context {
  if (!context.userId || !PURPOSES.has(context.purpose) || !context.email || context.email.length > 254) throw new OtpError("Invalid verification request.");
  return { userId: context.userId, email: context.email.trim().toLowerCase(), purpose: context.purpose };
}
async function lockUser(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  return tx.user.findUnique({ where: { id: userId } });
}
async function databaseNow(tx: Prisma.TransactionClient) {
  return (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0].now;
}
async function budget(tx: Prisma.TransactionClient, context: Context, now: Date, kind: "send" | "verify") {
  const where = { userId_purpose: { userId: context.userId, purpose: context.purpose } };
  const saved = await tx.otpThrottle.upsert({ where, create: { userId: context.userId, purpose: context.purpose, verificationWindowStart: now, sendWindowStart: now }, update: {} });
  if (kind === "send") {
    const reset = now.getTime() - saved.sendWindowStart.getTime() >= WINDOW_MS;
    const count = reset ? 0 : saved.sendCount;
    const cooldown = saved.lastSentAt ? 60_000 - (now.getTime() - saved.lastSentAt.getTime()) : 0;
    if (cooldown > 0) throw new OtpError("Please wait before requesting another code.", 429, Math.ceil(cooldown / 1000));
    if (count >= 3) throw new OtpError("Too many code requests. Please retry later.", 429, Math.max(1, Math.ceil((WINDOW_MS - (now.getTime() - saved.sendWindowStart.getTime())) / 1000)));
    await tx.otpThrottle.update({ where, data: { sendCount: count + 1, sendWindowStart: reset ? now : saved.sendWindowStart, lastSentAt: now } });
  } else {
    const reset = now.getTime() - saved.verificationWindowStart.getTime() >= WINDOW_MS;
    const count = reset ? 0 : saved.verificationAttempts;
    if (count >= 5) throw new OtpError("Too many verification attempts. Please request a new code after the verification window.", 429, Math.max(1, Math.ceil((WINDOW_MS - (now.getTime() - saved.verificationWindowStart.getTime())) / 1000)));
    await tx.otpThrottle.update({ where, data: { verificationAttempts: count + 1, verificationWindowStart: reset ? now : saved.verificationWindowStart } });
  }
}

/** Persist only an HMAC; code exists in memory and the actual mail payload. */
export async function issueOtp(input: Context, deliver: (code: string) => Promise<unknown>) {
  const context = normalize(input);
  secret();
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const saved = await prisma.$transaction(async (tx) => {
    const user = await lockUser(tx, context.userId);
    if (!user || (context.purpose !== "EMAIL_CHANGE" && user.email !== context.email) || (context.purpose === "REGISTRATION" && user.isVerified) || (context.purpose === "EMAIL_CHANGE" && user.email === context.email)) throw new OtpError("This verification request is no longer valid.");
    if (context.purpose === "EMAIL_CHANGE" && input.expectedAccountFingerprint !== otpAccountFingerprint(user)) throw new OtpError("Account credentials changed. Sign in again before changing email.", 409);
    const now = await databaseNow(tx);
    await budget(tx, context, now, "send");
    const token = { id: randomUUID(), ...context, accountFingerprint: otpAccountFingerprint(user) };
    await tx.otpToken.deleteMany({ where: { userId: context.userId, purpose: context.purpose } });
    return tx.otpToken.create({ data: { ...token, codeHash: otpCodeHash(token, code), createdAt: now, expiresAt: new Date(now.getTime() + WINDOW_MS) } });
  });
  try {
    await deliver(code);
    const marked = await prisma.$executeRaw`UPDATE "OtpToken" SET "deliveredAt" = clock_timestamp() WHERE id = ${saved.id} AND "deliveredAt" IS NULL`;
    if (marked !== 1) throw new OtpError("A newer verification request replaced this code. Use the latest message.", 409);
  } catch (error) {
    // Never delete a newer code or a token for another purpose/account.
    await prisma.otpToken.deleteMany({ where: { id: saved.id } });
    if (error instanceof OtpError) throw error;
    throw new OtpError("Email delivery is temporarily unavailable. Please retry shortly.", 503);
  }
}

/** Attempts commit even on a wrong code. The private in-memory ticket keeps
 * expensive password hashing outside a database lock; it is never sent to a client. */
export async function prepareOtpAttempt(input: Context, code: string): Promise<VerifiedOtp | null> {
  const context = normalize(input);
  secret();
  if (!/^\d{6}$/.test(code)) return null;
  const ticket = await prisma.$transaction(async (tx) => {
    const user = await lockUser(tx, context.userId);
    if (!user) return null;
    const now = await databaseNow(tx);
    await budget(tx, context, now, "verify");
    const token = await tx.otpToken.findUnique({ where: { userId_purpose: { userId: context.userId, purpose: context.purpose } } });
    if (!token || !token.deliveredAt || token.email !== context.email || token.expiresAt <= now || token.attempts >= 5 || token.accountFingerprint !== otpAccountFingerprint(user)) return null;
    await tx.otpToken.update({ where: { id: token.id }, data: { attempts: { increment: 1 } } });
    const candidate = Buffer.from(otpCodeHash(token, code), "hex");
    const stored = Buffer.from(token.codeHash, "hex");
    if (candidate.length !== stored.length || !timingSafeEqual(candidate, stored)) return null;
    return { id: token.id, userId: token.userId, email: token.email, purpose: token.purpose, codeHash: token.codeHash, accountFingerprint: token.accountFingerprint };
  });
  if (ticket) verifiedTickets.add(ticket);
  return ticket;
}

/** The action and single-use consumption commit/rollback together. */
export async function consumeVerifiedOtp<T>(ticket: VerifiedOtp, apply: (tx: Prisma.TransactionClient, user: User) => Promise<T>): Promise<T | null> {
  if (!verifiedTickets.has(ticket)) return null;
  const result = await prisma.$transaction(async (tx) => {
    const user = await lockUser(tx, ticket.userId);
    if (!user || otpAccountFingerprint(user) !== ticket.accountFingerprint) return null;
    const token = await tx.otpToken.findUnique({ where: { id: ticket.id } });
    const now = await databaseNow(tx);
    if (!token || token.userId !== ticket.userId || token.purpose !== ticket.purpose || token.email !== ticket.email || token.codeHash !== ticket.codeHash || token.accountFingerprint !== ticket.accountFingerprint || !token.deliveredAt || token.expiresAt <= now) return null;
    await tx.otpToken.delete({ where: { id: token.id } });
    const value = await apply(tx, user);
    await tx.otpToken.deleteMany({ where: { userId: user.id } });
    return value;
  });
  if (result !== null) verifiedTickets.delete(ticket);
  return result;
}
