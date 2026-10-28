jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("next/headers", () => ({ cookies: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: () => "127.0.0.1", rateLimit: jest.fn().mockResolvedValue({ success: true }) }));

import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import type { PrismaClient, User } from "@prisma/client";
import { SignJWT } from "jose";
import { hashPassword } from "../../lib/password";
import { signJwtToken, verifyJwtToken } from "../../lib/session-token";

const databaseSuite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
databaseSuite("real signed session revocation", () => {
  let db: PrismaClient;
  let validate: typeof import("@/lib/session-validation").validateSessionToken;
  let currentUser: typeof import("@/lib/session").getCurrentUser;
  const ids: string[] = [];
  const prefix = `audit-session-${randomUUID()}`;
  const password = "Session account!123";
  let passwordHash: string;
  const request = (body: unknown) => new Request("http://localhost/session-test", { method: "POST", body: JSON.stringify(body) });
  const authenticate = (token?: string) => (cookies as jest.Mock).mockResolvedValue({ get: () => token ? { value: token } : undefined });
  const createUser = async (isVerified = true) => {
    const user = await db.user.create({ data: { email: `${prefix}-${randomUUID()}@example.invalid`, password: passwordHash, isVerified } });
    ids.push(user.id); return user;
  };
  const tokenFor = (user: User) => signJwtToken(user);
  beforeAll(async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/audit_")) throw new Error("Session tests require a disposable local audit_* database.");
    process.env.DATABASE_URL = url.toString();
    process.env.JWT_SECRET = "local-only-session-test-signing-key-at-least-32-bytes";
    process.env.OTP_SECRET = "local-only-session-test-otp-key-at-least-32-bytes";
    db = (await import("@/lib/prisma")).prisma;
    ({ validateSessionToken: validate } = await import("@/lib/session-validation"));
    ({ getCurrentUser: currentUser } = await import("@/lib/session"));
    passwordHash = await hashPassword(password);
  }, 30_000);
  afterAll(async () => {
    if (!db) return;
    try { await db.user.deleteMany({ where: { id: { in: ids } } }); }
    finally { await db.$disconnect(); }
  });

  it("validates a real signed cookie against fresh database authority, rejecting tampering and missing versions", async () => {
    const user = await createUser();
    const token = await tokenFor(user);
    expect((await verifyJwtToken(token))?.sessionVersion).toBe(0);
    expect((await validate(token))?.id).toBe(user.id);
    authenticate(token);
    expect((await currentUser())?.id).toBe(user.id);
    const parts = token.split("."); parts[1] = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(parts[1], "base64url").toString()), role: "ADMIN" })).toString("base64url");
    expect(await validate(parts.join("."))).toBeNull();
    const old = await new SignJWT({ sub: user.id, email: user.email, role: user.role }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("7d").sign(new TextEncoder().encode(process.env.JWT_SECRET));
    expect(await validate(old)).toBeNull();
  });

  it("revokes both copied old cookies after password change, clears this browser and requires a new login", async () => {
    const user = await createUser();
    const first = await tokenFor(user); const copied = await tokenFor(user);
    authenticate(first);
    const { POST: change } = await import("@/app/api/user/change-password/route");
    const result = await change(request({ currentPassword: password, newPassword: "Changed session!123", confirmPassword: "Changed session!123" }));
    expect(result.status).toBe(200);
    expect(result.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await validate(first)).toBeNull(); expect(await validate(copied)).toBeNull();
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).sessionVersion).toBe(1);
    const { POST: login } = await import("@/app/api/auth/login/route");
    const signedIn = await login(request({ email: user.email, password: "Changed session!123" }));
    expect(signedIn.status).toBe(200);
    const fresh = signedIn.headers.get("set-cookie")!.match(/auth_token=([^;]+)/)![1];
    expect((await validate(fresh))?.id).toBe(user.id);
    authenticate(copied);
    expect((await change(request({ currentPassword: "Changed session!123", newPassword: "Ignored!123", confirmPassword: "Ignored!123" }))).status).toBe(401);
  });

  it("revokes old cookies after OTP reset and leaves failed reset/changes non-revoking", async () => {
    const user = await createUser(); const token = await tokenFor(user);
    authenticate(token);
    const { POST: change } = await import("@/app/api/user/change-password/route");
    expect((await change(request({ currentPassword: "Wrong!123", newPassword: "Changed!123", confirmPassword: "Changed!123" }))).status).toBe(400);
    expect((await validate(token))?.id).toBe(user.id);
    const { issueOtp } = await import("@/lib/otp");
    let code = "";
    await issueOtp({ userId: user.id, email: user.email, purpose: "PASSWORD_RESET" }, async (value) => { code = value; });
    const { POST: reset } = await import("@/app/api/auth/reset-password/route");
    expect((await reset(request({ email: user.email, otp: code, newPassword: "Reset session!123" }))).status).toBe(200);
    expect(await validate(token)).toBeNull();
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).sessionVersion).toBe(1);
  });

  it("enforces revocation at me, profile, avatar and server-action session boundaries", async () => {
    const user = await createUser(); const token = await tokenFor(user);
    await db.user.update({ where: { id: user.id }, data: { password: await hashPassword("Operator reset!123") } });
    authenticate(token);
    const { GET: me } = await import("@/app/api/auth/me/route");
    const { GET: profile, PUT: updateProfile } = await import("@/app/api/user/profile/route");
    const { POST: avatar, DELETE: removeAvatar } = await import("@/app/api/user/upload-avatar/route");
    expect((await (await me()).json()).success).toBe(false);
    expect((await profile()).status).toBe(401);
    expect((await updateProfile(request({ name: "Unauthorized update" }))).status).toBe(401);
    expect((await avatar(request({ avatar: "data:image/png;base64,ignored" }))).status).toBe(401);
    expect((await removeAvatar()).status).toBe(401);
    expect(await currentUser()).toBeNull();
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).name).toBeNull();
  });

  it.each([
    { email: "changed" }, { role: "ADMIN" }, { sellerStatus: "BLOCKED" }, { isVerified: false },
  ])("revokes a signed session on security-state mutation %j", async (mutation) => {
    const user = await createUser(); const token = await tokenFor(user);
    const data = mutation.email ? { email: `${prefix}-${randomUUID()}@example.invalid` } : mutation;
    await db.user.update({ where: { id: user.id }, data });
    expect(await validate(token)).toBeNull();
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).sessionVersion).toBe(1);
  });

  it("preserves sessions for ordinary profile edits and rejects manual version rollback", async () => {
    const user = await createUser(); const token = await tokenFor(user);
    await db.user.update({ where: { id: user.id }, data: { name: "Updated profile", phone: "01700000000", avatar: null } });
    expect((await validate(token))?.id).toBe(user.id);
    await db.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
    expect(await validate(token)).toBeNull();
    await expect(db.user.update({ where: { id: user.id }, data: { sessionVersion: 0 } })).rejects.toThrow();
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).sessionVersion).toBe(1);
  });

  it("never authorizes a deleted account or an expired/wrong-algorithm token", async () => {
    const user = await createUser(); const token = await tokenFor(user);
    const key = new TextEncoder().encode(process.env.JWT_SECRET);
    const claims = { sub: user.id, email: user.email, role: user.role, sessionVersion: user.sessionVersion };
    const expired = await new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) - 1).sign(key);
    const wrongAlgorithm = await new SignJWT(claims).setProtectedHeader({ alg: "HS384" }).setIssuedAt().setExpirationTime("7d").sign(key);
    expect(await validate(expired)).toBeNull(); expect(await validate(wrongAlgorithm)).toBeNull();
    await db.user.delete({ where: { id: user.id } }); expect(await validate(token)).toBeNull();
  });

  it("issues a usable post-verification version and rotates the current email-change session", async () => {
    const user = await createUser(false);
    const { issueOtp, otpAccountFingerprint } = await import("@/lib/otp");
    let code = "";
    await issueOtp({ userId: user.id, email: user.email, purpose: "REGISTRATION" }, async (value) => { code = value; });
    const { POST: verify } = await import("@/app/api/auth/verify-otp/route");
    const verified = await verify(request({ email: user.email, otp: code, password }));
    expect(verified.status).toBe(200);
    const signupCookie = verified.headers.get("set-cookie")!.match(/auth_token=([^;]+)/)![1];
    expect((await validate(signupCookie))?.sessionVersion).toBe(1);
    const account = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    const newEmail = `${prefix}-new-${randomUUID()}@example.invalid`;
    await issueOtp({ userId: account.id, email: newEmail, purpose: "EMAIL_CHANGE", expectedAccountFingerprint: otpAccountFingerprint(account) }, async (value) => { code = value; });
    authenticate(signupCookie);
    const { POST: changeEmail } = await import("@/app/api/user/change-email/verify/route");
    const changed = await changeEmail(request({ newEmail, otp: code }));
    expect(changed.status).toBe(200);
    const replacement = changed.headers.get("set-cookie")!.match(/auth_token=([^;]+)/)![1];
    expect(await validate(signupCookie)).toBeNull();
    expect((await validate(replacement))?.email).toBe(newEmail);
    expect((await validate(replacement))?.sessionVersion).toBe(2);
  });

  it("rejects an old-password login if a reset commits after its account read", async () => {
    const user = await createUser();
    const resetHash = await hashPassword("Reset wins session!123");
    const realFind = db.user.findUnique.bind(db.user);
    const find = jest.spyOn(db.user, "findUnique") as jest.SpyInstance<Promise<User | null>, [Parameters<typeof db.user.findUnique>[0]]>;
    find.mockImplementationOnce(async (args) => {
      const old = await realFind(args);
      await db.user.update({ where: { id: user.id }, data: { password: resetHash } });
      return old;
    });
    try {
      const { POST: login } = await import("@/app/api/auth/login/route");
      const result = await login(request({ email: user.email, password }));
      expect(result.status).toBe(401);
      expect(result.headers.get("set-cookie")).toBeNull();
    } finally { find.mockRestore(); }
  });

  it("serializes competing password changes and rolls back version increments with a failed transaction", async () => {
    const user = await createUser(); const token = await tokenFor(user);
    authenticate(token);
    const { POST: change } = await import("@/app/api/user/change-password/route");
    const body = { currentPassword: password, newPassword: "Concurrent change!123", confirmPassword: "Concurrent change!123" };
    const results = await Promise.all([change(request(body)), change(request(body))]);
    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
    expect(results.every((result) => [200, 401, 409].includes(result.status))).toBe(true);
    expect(await validate(token)).toBeNull();
    const account = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    const fresh = await tokenFor(account);
    await expect(db.$transaction(async (tx) => { await tx.user.update({ where: { id: user.id }, data: { role: "ADMIN" } }); throw new Error("Test rollback"); })).rejects.toThrow("Test rollback");
    expect((await validate(fresh))?.sessionVersion).toBe(account.sessionVersion);
  });
});
