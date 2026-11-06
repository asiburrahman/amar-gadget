jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("next/headers", () => ({ cookies: jest.fn().mockResolvedValue({ get: () => ({ value: "isolated-account-test" }) }) }));
jest.mock("@/lib/session-validation", () => ({ validateSessionToken: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: jest.fn(() => "192.0.2.1"), rateLimit: jest.fn().mockResolvedValue({ success: true }) }));
jest.mock("@/lib/mail/send-otp", () => ({ sendOtpEmail: jest.fn().mockResolvedValue({ success: true }) }));

import { randomUUID } from "node:crypto";
import type { PrismaClient, User } from "@prisma/client";
import { validateSessionToken } from "@/lib/session-validation";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { sendOtpEmail } from "@/lib/mail/send-otp";
import { hashPassword } from "../../lib/password";

const databaseSuite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
databaseSuite("account endpoint validation and independent budgets", () => {
  let db: PrismaClient;
  let user: User;
  let profile: typeof import("@/app/api/user/profile/route").PUT;
  let changePassword: typeof import("@/app/api/user/change-password/route").POST;
  let register: typeof import("@/app/api/auth/register/route").POST;
  let login: typeof import("@/app/api/auth/login/route").POST;
  let reset: typeof import("@/app/api/auth/reset-password/route").POST;
  const prefix = `audit-validation-${randomUUID()}`;
  const password = "Original password!123";
  const req = (data: unknown) => new Request("http://localhost/account-test", { method: "POST", body: JSON.stringify(data) });
  beforeAll(async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/audit_")) throw new Error("Account tests require a disposable local audit_* database.");
    process.env.DATABASE_URL = url.toString();
    db = (await import("@/lib/prisma")).prisma;
    user = await db.user.create({ data: { email: `${prefix}@example.invalid`, name: "Original owner", password: await hashPassword(password), isVerified: true } });
    ({ PUT: profile } = await import("@/app/api/user/profile/route"));
    ({ POST: changePassword } = await import("@/app/api/user/change-password/route"));
    ({ POST: register } = await import("@/app/api/auth/register/route"));
    ({ POST: login } = await import("@/app/api/auth/login/route"));
    ({ POST: reset } = await import("@/app/api/auth/reset-password/route"));
  }, 30_000);
  beforeEach(() => {
    jest.clearAllMocks();
    (validateSessionToken as jest.Mock).mockResolvedValue(user);
    (rateLimit as jest.Mock).mockResolvedValue({ success: true });
    (getClientIp as jest.Mock).mockReturnValue("192.0.2.1");
    (sendOtpEmail as jest.Mock).mockResolvedValue({ success: true });
  });
  afterAll(async () => { if (db) { try { await db.user.deleteMany({ where: { email: { startsWith: prefix } } }); } finally { await db.$disconnect(); } } });

  it("rejects malformed JSON on each actual mutation route before modifying account state", async () => {
    for (const handler of [profile, changePassword, register, login, reset]) {
      expect((await handler(new Request("http://localhost/invalid", { method: "POST", body: "{" }))).status).toBe(400);
    }
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).password).toBe(user.password);
  });
  it("rejects oversized body declarations and typed profile/mass-assignment payloads before writes", async () => {
    expect((await login(new Request("http://localhost/large", { method: "POST", body: "{}", headers: { "Content-Length": "20000" } }))).status).toBe(413);
    for (const data of [{ name: 5 }, { name: "a".repeat(121) }, { role: "ADMIN", name: "Bad actor" }, { avatar: "javascript:alert(1)" }, { name: "Must not persist", address: { street: "incomplete" } }]) {
      expect((await profile(req(data))).status).toBe(400);
    }
    const current = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(current.name).toBe(user.name); expect(current.role).toBe("USER");
    expect(await db.address.count({ where: { userId: user.id } })).toBe(0);
  });
  it("uses the shared new-password policy for all password writers without changing credentials on rejection", async () => {
    const weak = "abc123";
    expect((await register(req({ name: "New person", email: `${prefix}-weak@example.invalid`, password: weak }))).status).toBe(400);
    expect((await changePassword(req({ currentPassword: password, newPassword: weak, confirmPassword: weak }))).status).toBe(400);
    expect((await reset(req({ email: user.email, otp: "012345", newPassword: weak }))).status).toBe(400);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).password).toBe(user.password);
  });
  it.each(["ip", "account"])("denies a %s budget before password work or profile mutation", async (kind) => {
    for (const handler of [profile, changePassword]) {
      (rateLimit as jest.Mock).mockReset().mockResolvedValue({ success: false });
      if (kind === "account") (rateLimit as jest.Mock).mockResolvedValueOnce({ success: true });
      const result = await handler(req({ name: "Denied mutation", currentPassword: password, newPassword: "Allowed policy!123", confirmPassword: "Allowed policy!123" }));
      expect(result.status).toBe(429); expect(Number(result.headers.get("Retry-After"))).toBeGreaterThan(0);
    }
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).password).toBe(user.password);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).name).toBe(user.name);
  });
  it("uses the same email account key across source IP changes and before account lookup", async () => {
    (rateLimit as jest.Mock).mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false });
    (getClientIp as jest.Mock).mockReturnValueOnce("192.0.2.1").mockReturnValueOnce("192.0.2.2");
    const result = await login(req({ email: " UNKNOWN@Example.invalid ", password: "Any password" }));
    expect(result.status).toBe(429);
    expect((await login(req({ email: "unknown@example.invalid", password: "Any password" }))).status).toBe(429);
    const calls = (rateLimit as jest.Mock).mock.calls;
    expect(calls[0][3]).toBe("auth-login:ip"); expect(calls[1][3]).toBe("auth-login:account");
    expect(calls[1][0]).toMatch(/^[a-f0-9]{64}$/);
    expect(calls[0][0]).not.toBe(calls[2][0]); expect(calls[1][0]).toBe(calls[3][0]);
  });
  it("returns normalized server profile fields and bounds address data", async () => {
    const response = await profile(req({ name: "  Updated owner  ", phone: " 01700000000 " }));
    expect(response.status).toBe(200);
    expect((await response.json()).user.name).toBe("Updated owner");
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).sessionVersion).toBe(user.sessionVersion);
    await db.user.update({ where: { id: user.id }, data: { name: user.name, phone: null } });
  });
  it("returns generic accepted reset responses for absent, deliverable and temporarily undeliverable accounts", async () => {
    const { POST: forgot } = await import("@/app/api/auth/forgot-password/route");
    const absent = await forgot(req({ email: `${prefix}-absent@example.invalid` }));
    const present = await forgot(req({ email: user.email }));
    (sendOtpEmail as jest.Mock).mockResolvedValueOnce({ success: false, status: 503, error: "Provider detail must stay private" });
    const unavailable = await forgot(req({ email: user.email }));
    expect([absent.status, present.status, unavailable.status]).toEqual([200, 200, 200]);
    expect(await absent.json()).toEqual(await present.json());
    const body = await unavailable.json(); expect(body.accepted).toBe(true); expect(JSON.stringify(body)).not.toContain("Provider detail");
  });
  it("redacts database exceptions from profile responses and logs", async () => {
    const update = jest.spyOn(db, "$transaction").mockRejectedValueOnce(new Error("private connection and payload details"));
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = await profile(req({ name: "Failure case" }));
      expect(result.status).toBe(503);
      expect(JSON.stringify(await result.json())).not.toContain("private connection");
      expect(JSON.stringify(log.mock.calls)).not.toContain("private connection");
    } finally { update.mockRestore(); log.mockRestore(); }
  });
});
