jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn().mockResolvedValue(null) }));
jest.mock("@/lib/auth", () => ({ ...jest.requireActual("@/lib/password"), signJwtToken: jest.fn().mockResolvedValue("local-otp-test-session") }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: () => "127.0.0.1", rateLimit: jest.fn().mockResolvedValue({ success: true }) }));
const mockSendMail = jest.fn();
jest.mock("@/lib/mail/nodemailer", () => ({ getMailTransport: () => ({ sendMail: mockSendMail }), MailConfigurationError: class extends Error {} }));

import { randomUUID } from "node:crypto";
import type { PrismaClient, User } from "@prisma/client";
import { hashPassword, verifyPassword } from "../../lib/password";
import { getCurrentUser } from "@/lib/session";

const databaseSuite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
databaseSuite("purpose-bound, hashed, atomic OTP security", () => {
  let db: PrismaClient;
  let otp: typeof import("@/lib/otp");
  let send: typeof import("@/lib/mail/send-otp").sendOtpEmail;
  let verify: typeof import("@/app/api/auth/verify-otp/route").POST;
  let reset: typeof import("@/app/api/auth/reset-password/route").POST;
  let requestEmail: typeof import("@/app/api/user/change-email/request/route").POST;
  let confirmEmail: typeof import("@/app/api/user/change-email/verify/route").POST;
  let storedPassword: string;
  const password = "OTP account password!123";
  const prefix = `audit-otp-${randomUUID()}`;
  const ids: string[] = [];
  type Message = { to: string; subject: string; text: string; html: string };
  const sent: Message[] = [];
  const req = (body: unknown) => new Request("http://localhost/otp-test", { method: "POST", body: JSON.stringify(body) });
  const codeFromLastMail = () => { const code = sent[sent.length - 1]?.text.match(/\b(\d{6})\b/)?.[1]; if (!code) throw new Error("Test mail did not contain a six-digit code."); return code; };
  const createUser = async (verified = false) => {
    const user = await db.user.create({ data: { email: `${prefix}-${randomUUID()}@example.invalid`, password: storedPassword, isVerified: verified } });
    ids.push(user.id); return user;
  };
  async function issue(user: User, purpose: import("@/lib/otp").OtpPurpose, email = user.email) {
    const result = await send({ userId: user.id, email, purpose, ...(purpose === "EMAIL_CHANGE" ? { expectedAccountFingerprint: otp.otpAccountFingerprint(user) } : {}) });
    expect(result).toEqual({ success: true });
    return { code: codeFromLastMail(), token: await db.otpToken.findUniqueOrThrow({ where: { userId_purpose: { userId: user.id, purpose } } }) };
  }
  const allowResend = (userId: string, purpose: string) => db.otpThrottle.update({ where: { userId_purpose: { userId, purpose } }, data: { lastSentAt: new Date(Date.now() - 61_000) } });

  beforeAll(async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/audit_")) throw new Error("OTP integration tests require a disposable local audit_* database.");
    process.env.DATABASE_URL = url.toString();
    process.env.OTP_SECRET = "local-only-otp-security-test-key-at-least-32-bytes";
    process.env.SMTP_FROM = "Local tests <security@example.invalid>";
    db = (await import("@/lib/prisma")).prisma;
    otp = await import("@/lib/otp");
    ({ sendOtpEmail: send } = await import("@/lib/mail/send-otp"));
    ({ POST: verify } = await import("@/app/api/auth/verify-otp/route"));
    ({ POST: reset } = await import("@/app/api/auth/reset-password/route"));
    ({ POST: requestEmail } = await import("@/app/api/user/change-email/request/route"));
    ({ POST: confirmEmail } = await import("@/app/api/user/change-email/verify/route"));
    storedPassword = await hashPassword(password);
  }, 30_000);
  beforeEach(() => {
    jest.clearAllMocks(); sent.length = 0;
    mockSendMail.mockReset().mockImplementation(async (message: Message) => { sent.push(message); return { accepted: [message.to] }; });
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    const auth = jest.requireMock("@/lib/auth");
    auth.signJwtToken.mockReset().mockResolvedValue("local-otp-test-session");
  });
  afterAll(async () => {
    if (!db) return;
    try { await db.user.deleteMany({ where: { id: { in: ids } } }); }
    finally { await db.$disconnect(); }
  });

  it("stores keyed hashes only and binds them to token, user, purpose, target and account state", async () => {
    const user = await createUser();
    const issued = await issue(user, "REGISTRATION");
    expect(issued.token).not.toHaveProperty("code");
    expect(issued.token.codeHash).toHaveLength(64);
    expect(issued.token.codeHash).not.toBe(issued.code);
    expect(issued.token.deliveredAt).not.toBeNull();
    const variants = [{}, { id: randomUUID() }, { userId: randomUUID() }, { purpose: "PASSWORD_RESET" }, { email: "other@example.invalid" }, { accountFingerprint: "0".repeat(64) }];
    expect(new Set(variants.map((changes) => otp.otpCodeHash({ ...issued.token, ...changes }, issued.code))).size).toBe(variants.length);
    expect(sent[0].subject).toContain("Verify your email");
  });

  it("requires the registration password and does not turn a signup code into a password reset", async () => {
    const user = await createUser();
    const { code } = await issue(user, "REGISTRATION");
    expect((await reset(req({ email: user.email, otp: code, newPassword: "Attacker-chosen!123" }))).status).toBe(400);
    expect((await verify(req({ email: user.email, otp: code, password: "Incorrect password!123" }))).status).toBe(400);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).isVerified).toBe(false);
    const accepted = await verify(req({ email: user.email, otp: code, password }));
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get("set-cookie")).toContain("HttpOnly");
    expect((await verify(req({ email: user.email, otp: code, password }))).status).toBe(400);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).password).toBe(storedPassword);
  });

  it("does not establish a registration login with a reset code; reset remains single-use and does not sign in", async () => {
    const user = await createUser();
    const { code } = await issue(user, "PASSWORD_RESET");
    expect(sent[0].subject).toContain("Reset your password");
    expect((await verify(req({ email: user.email, otp: code, password }))).status).toBe(400);
    const body = { email: user.email, otp: code, newPassword: "Reset to a private password!123" };
    const responses = await Promise.all([reset(req(body)), reset(req(body))]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
    expect(responses.find((response) => response.status === 200)?.headers.get("set-cookie")).toBeNull();
    expect(await verifyPassword(body.newPassword, (await db.user.findUniqueOrThrow({ where: { id: user.id } })).password)).toBe(true);
  });

  it("reauthenticates email-change requests and binds the target code to the requesting account", async () => {
    const owner = await createUser(true), other = await createUser(true);
    const newEmail = `${prefix}-${randomUUID()}@example.invalid`;
    (getCurrentUser as jest.Mock).mockResolvedValue(owner);
    expect((await requestEmail(req({ newEmail, currentPassword: "Incorrect!123" }))).status).toBe(400);
    expect(mockSendMail).not.toHaveBeenCalled();
    expect((await requestEmail(req({ newEmail, currentPassword: password }))).status).toBe(200);
    expect(sent[0].subject).toContain("Confirm your email change");
    const code = codeFromLastMail();
    (getCurrentUser as jest.Mock).mockResolvedValue(other);
    expect((await confirmEmail(req({ newEmail, otp: code }))).status).toBe(400);
    expect((await db.user.findUniqueOrThrow({ where: { id: other.id } })).email).toBe(other.email);
    (getCurrentUser as jest.Mock).mockResolvedValue(owner);
    const responses = await Promise.all([confirmEmail(req({ newEmail, otp: code })), confirmEmail(req({ newEmail, otp: code }))]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
    expect((await db.user.findUniqueOrThrow({ where: { id: owner.id } })).email).toBe(newEmail);
    expect(await db.otpToken.count({ where: { userId: owner.id } })).toBe(0);
  });

  it("does not mutate state if session signing fails before OTP consumption", async () => {
    const user = await createUser();
    const { code } = await issue(user, "REGISTRATION");
    jest.requireMock("@/lib/auth").signJwtToken.mockRejectedValueOnce(new Error("Signing configuration failure"));
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect((await verify(req({ email: user.email, otp: code, password }))).status).toBe(503);
      expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).isVerified).toBe(false);
      expect(await db.otpToken.count({ where: { userId: user.id } })).toBe(1);
    } finally { log.mockRestore(); }
    expect((await verify(req({ email: user.email, otp: code, password }))).status).toBe(200);
  });

  it("rolls back email conflicts together with consumption and never consumes another account's code", async () => {
    const owner = await createUser(true), claimant = await createUser(true);
    const newEmail = `${prefix}-${randomUUID()}@example.invalid`;
    const { code } = await issue(owner, "EMAIL_CHANGE", newEmail);
    await db.user.update({ where: { id: claimant.id }, data: { email: newEmail } });
    (getCurrentUser as jest.Mock).mockResolvedValue(owner);
    expect((await confirmEmail(req({ newEmail, otp: code }))).status).toBe(409);
    expect((await db.user.findUniqueOrThrow({ where: { id: owner.id } })).email).toBe(owner.email);
    expect(await db.otpToken.count({ where: { userId: owner.id } })).toBe(1);
    await db.user.update({ where: { id: claimant.id }, data: { email: claimant.email } });
    expect((await confirmEmail(req({ newEmail, otp: code }))).status).toBe(200);
  });

  it("commits failed-attempt budgets across resends without extending an exhausted window", async () => {
    const user = await createUser();
    const first = await issue(user, "PASSWORD_RESET");
    const context = { userId: user.id, email: user.email, purpose: "PASSWORD_RESET" as const };
    const wrong = (code: string) => code === "000000" ? "111111" : "000000";
    for (let index = 0; index < 3; index++) expect(await otp.prepareOtpAttempt(context, wrong(first.code))).toBeNull();
    await allowResend(user.id, context.purpose);
    const second = await issue(user, "PASSWORD_RESET");
    for (let index = 0; index < 2; index++) expect(await otp.prepareOtpAttempt(context, wrong(second.code))).toBeNull();
    const where = { userId_purpose: { userId: user.id, purpose: context.purpose } };
    const before = await db.otpThrottle.findUniqueOrThrow({ where });
    await expect(otp.prepareOtpAttempt(context, second.code)).rejects.toMatchObject({ status: 429 });
    const after = await db.otpThrottle.findUniqueOrThrow({ where });
    expect(after.verificationAttempts).toBe(5);
    expect(after.verificationWindowStart).toEqual(before.verificationWindowStart);
    await db.otpThrottle.update({ where, data: { verificationWindowStart: new Date(Date.now() - 601_000) } });
    expect(await otp.prepareOtpAttempt(context, second.code)).not.toBeNull();
  });

  it("limits distributed concurrent guesses at the database account budget", async () => {
    const user = await createUser();
    const { code } = await issue(user, "PASSWORD_RESET");
    const wrong = code === "000000" ? "111111" : "000000";
    const context = { userId: user.id, email: user.email, purpose: "PASSWORD_RESET" as const };
    const results = await Promise.allSettled(Array.from({ length: 7 }, () => otp.prepareOtpAttempt(context, wrong)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(5);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(2);
    expect((await db.otpToken.findUniqueOrThrow({ where: { userId_purpose: { userId: user.id, purpose: context.purpose } } })).attempts).toBe(5);
  });

  it("preserves the active code on cooldown and caps sends in a fixed per-account window", async () => {
    const user = await createUser();
    const first = await issue(user, "PASSWORD_RESET");
    const context = { userId: user.id, email: user.email, purpose: "PASSWORD_RESET" as const };
    expect(await send(context)).toMatchObject({ success: false, status: 429 });
    expect((await db.otpToken.findUniqueOrThrow({ where: { id: first.token.id } })).id).toBe(first.token.id);
    for (let index = 0; index < 2; index++) { await allowResend(user.id, context.purpose); await issue(user, "PASSWORD_RESET"); }
    await allowResend(user.id, context.purpose);
    const before = await db.otpThrottle.findUniqueOrThrow({ where: { userId_purpose: { userId: user.id, purpose: context.purpose } } });
    expect(await send(context)).toMatchObject({ success: false, status: 429 });
    const after = await db.otpThrottle.findUniqueOrThrow({ where: { userId_purpose: { userId: user.id, purpose: context.purpose } } });
    expect(after.sendCount).toBe(3);
    expect(after.sendWindowStart).toEqual(before.sendWindowStart);
  });

  it("keeps pending mail unusable and removes failed mail only for its own purpose", async () => {
    const user = await createUser();
    let release!: () => void, code = "";
    const pending = otp.issueOtp({ userId: user.id, email: user.email, purpose: "REGISTRATION" }, async (value) => { code = value; await new Promise<void>((resolve) => { release = resolve; }); });
    const deadline = Date.now() + 3_000;
    while (!release) { if (Date.now() > deadline) throw new Error("Pending mail fixture did not initialize."); await new Promise((resolve) => setTimeout(resolve, 10)); }
    try {
      expect(await otp.prepareOtpAttempt({ userId: user.id, email: user.email, purpose: "REGISTRATION" }, code)).toBeNull();
      mockSendMail.mockRejectedValueOnce(new Error("Controlled provider failure"));
      expect(await send({ userId: user.id, email: user.email, purpose: "PASSWORD_RESET" })).toMatchObject({ success: false, status: 503 });
      expect(await db.otpToken.count({ where: { userId: user.id, purpose: "PASSWORD_RESET" } })).toBe(0);
      expect(await db.otpToken.count({ where: { userId: user.id, purpose: "REGISTRATION" } })).toBe(1);
    } finally { release(); await pending; }
    expect(await otp.prepareOtpAttempt({ userId: user.id, email: user.email, purpose: "REGISTRATION" }, code)).not.toBeNull();
  });

  it.each(["password", "email", "role", "sellerStatus"])("invalidates pending codes when account %s changes", async (field) => {
    const user = await createUser();
    const { code } = await issue(user, "PASSWORD_RESET");
    const data = field === "password" ? { password: "changed-by-another-auth-operation" } : field === "email" ? { email: `${prefix}-${randomUUID()}@example.invalid` } : field === "role" ? { role: "MEMBER" } : { sellerStatus: "BLOCKED" };
    await db.user.update({ where: { id: user.id }, data });
    expect(await otp.prepareOtpAttempt({ userId: user.id, email: user.email, purpose: "PASSWORD_RESET" }, code)).toBeNull();
  });

  it("cannot consume expired, superseded or forged tickets and rolls back failed mutations", async () => {
    const user = await createUser();
    const first = await issue(user, "PASSWORD_RESET");
    const context = { userId: user.id, email: user.email, purpose: "PASSWORD_RESET" as const };
    expect(await otp.consumeVerifiedOtp(first.token, async () => "forged")).toBeNull();
    const ticket = await otp.prepareOtpAttempt(context, first.code);
    if (!ticket) throw new Error("Expected valid fixture ticket.");
    await expect(otp.consumeVerifiedOtp(ticket, async (tx) => { await tx.user.update({ where: { id: user.id }, data: { name: "Rolled back" } }); throw new Error("Controlled rollback"); })).rejects.toThrow("Controlled rollback");
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).name).toBeNull();
    expect(await db.otpToken.count({ where: { id: first.token.id } })).toBe(1);
    await allowResend(user.id, context.purpose);
    const second = await issue(user, "PASSWORD_RESET");
    expect(await otp.consumeVerifiedOtp(ticket, async () => "old ticket")).toBeNull();
    await db.otpToken.update({ where: { id: second.token.id }, data: { expiresAt: new Date(0) } });
    expect(await otp.prepareOtpAttempt(context, second.code)).toBeNull();
  });

  it("fails closed before token writes if the private HMAC key is unavailable", async () => {
    const user = await createUser();
    const secret = process.env.OTP_SECRET;
    delete process.env.OTP_SECRET;
    try {
      expect(await send({ userId: user.id, email: user.email, purpose: "REGISTRATION" })).toMatchObject({ success: false, status: 503 });
      expect(await db.otpToken.count({ where: { userId: user.id } })).toBe(0);
      expect(mockSendMail).not.toHaveBeenCalled();
    } finally { process.env.OTP_SECRET = secret; }
  });

  it("rejects a stale password reauthentication snapshot before issuing email-change mail", async () => {
    const user = await createUser(true);
    const expectedAccountFingerprint = otp.otpAccountFingerprint(user);
    await db.user.update({ where: { id: user.id }, data: { password: await hashPassword("A newer private password!123") } });
    const result = await send({ userId: user.id, email: `${prefix}-${randomUUID()}@example.invalid`, purpose: "EMAIL_CHANGE", expectedAccountFingerprint });
    expect(result).toMatchObject({ success: false, status: 409 });
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(await db.otpToken.count({ where: { userId: user.id } })).toBe(0);
  });

  it("preserves the old email and token if replacement-session signing fails", async () => {
    const user = await createUser(true);
    const target = `${prefix}-${randomUUID()}@example.invalid`;
    const { code } = await issue(user, "EMAIL_CHANGE", target);
    (getCurrentUser as jest.Mock).mockResolvedValue(user);
    jest.requireMock("@/lib/auth").signJwtToken.mockRejectedValueOnce(new Error("Controlled signing failure"));
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect((await confirmEmail(req({ newEmail: target, otp: code }))).status).toBe(503);
      expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(user.email);
      expect(await db.otpToken.count({ where: { userId: user.id } })).toBe(1);
    } finally { log.mockRestore(); }
    expect((await confirmEmail(req({ newEmail: target, otp: code }))).status).toBe(200);
  });

  it("does not let a delayed older delivery mark or delete a newer code", async () => {
    const user = await createUser();
    let release!: () => void;
    const first = otp.issueOtp({ userId: user.id, email: user.email, purpose: "PASSWORD_RESET" }, async () => { await new Promise<void>((resolve) => { release = resolve; }); });
    const firstResult = first.catch((error: unknown) => error);
    const deadline = Date.now() + 3_000;
    while (!release) { if (Date.now() > deadline) throw new Error("Delayed delivery fixture did not initialize."); await new Promise((resolve) => setTimeout(resolve, 10)); }
    try {
      await allowResend(user.id, "PASSWORD_RESET");
      const latest = await issue(user, "PASSWORD_RESET");
      release();
      expect(await firstResult).toMatchObject({ status: 409 });
      const remaining = await db.otpToken.findUniqueOrThrow({ where: { id: latest.token.id } });
      expect(remaining.deliveredAt).not.toBeNull();
      expect(await otp.prepareOtpAttempt({ userId: user.id, email: user.email, purpose: "PASSWORD_RESET" }, latest.code)).not.toBeNull();
    } finally { release(); await firstResult; }
  });

  it("does not grant email-change access without a session or from malformed input", async () => {
    expect((await requestEmail(req({ newEmail: "other@example.invalid", currentPassword: password }))).status).toBe(401);
    expect((await confirmEmail(req({ newEmail: "other@example.invalid", otp: "123456" }))).status).toBe(401);
    const user = await createUser(true);
    (getCurrentUser as jest.Mock).mockResolvedValue(user);
    expect((await requestEmail(req({ newEmail: "bad-email" }))).status).toBe(400);
    expect((await confirmEmail(req({ newEmail: "other@example.invalid", otp: "12345" }))).status).toBe(400);
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});
