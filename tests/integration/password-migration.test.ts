jest.mock("next/headers", () => ({ cookies: jest.fn().mockResolvedValue({ get: () => ({ value: "local-test-token" }) }) }));
jest.mock("@/lib/auth", () => ({ ...jest.requireActual("@/lib/password"), signJwtToken: jest.fn().mockResolvedValue("local-test-token"), verifyJwtToken: jest.fn() }));
jest.mock("@/lib/mail/send-otp", () => ({ sendOtpEmail: jest.fn().mockResolvedValue({ success: true }) }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: () => "127.0.0.1", rateLimit: jest.fn().mockResolvedValue({ success: true }) }));

import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { hashPassword, verifyPassword } from "../../lib/password";
import { verifyJwtToken } from "@/lib/auth";
import { spawnSync } from "node:child_process";

const databaseSuite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
databaseSuite("compatible password storage migration", () => {
  let db: PrismaClient;
  let login: typeof import("@/app/api/auth/login/route").POST;
  const prefix = `audit-password-${randomUUID()}`;
  const password = "Legacy Password!123";
  const legacyHash = () => {
    const salt = randomBytes(16).toString("hex");
    return `${salt}:${pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex")}`;
  };
  const request = (body: unknown) => new Request("http://localhost/password-test", { method: "POST", body: JSON.stringify(body) });
  beforeAll(async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/audit_")) throw new Error("Password integration tests require a disposable local audit_* database.");
    process.env.DATABASE_URL = url.toString();
    process.env.OTP_SECRET = "isolated-password-migration-otp-key-at-least-32-bytes";
    db = (await import("@/lib/prisma")).prisma;
    ({ POST: login } = await import("@/app/api/auth/login/route"));
  }, 30_000);
  afterAll(async () => {
    if (!db) return;
    try {
      await db.otpToken.deleteMany({ where: { email: { startsWith: prefix } } });
      await db.user.deleteMany({ where: { email: { startsWith: prefix } } });
    } finally { await db.$disconnect(); }
  });
  const buyer = async () => db.user.create({ data: { email: `${prefix}-${randomUUID()}@example.invalid`, password: legacyHash(), isVerified: true } });

  it("rejects wrong credentials without rewriting the hash and upgrades a successful legacy login", async () => {
    const user = await buyer();
    expect((await login(request({ email: user.email, password: "Incorrect password!123" }))).status).toBe(401);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).password).toBe(user.password);
    const response = await login(request({ email: user.email, password }));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    const current = (await db.user.findUniqueOrThrow({ where: { id: user.id } })).password!;
    expect(current).toMatch(/^scrypt\$v1\$/);
    expect(await verifyPassword(password, current)).toBe(true);
    expect((await response.json()).user.password).toBeUndefined();
  });

  it("allows concurrent successful legacy logins without overwriting a reset", async () => {
    const user = await buyer();
    const results = await Promise.all([login(request({ email: user.email, password })), login(request({ email: user.email, password }))]);
    expect(results.map((response) => response.status)).toEqual([200, 200]);
    expect(await verifyPassword(password, (await db.user.findUniqueOrThrow({ where: { id: user.id } })).password)).toBe(true);
    const resetUser = await buyer();
    const replacement = await hashPassword("Reset wins!123");
    const update = jest.spyOn(db.user, "updateMany") as jest.SpyInstance<Promise<{ count: number }>>;
    update.mockImplementationOnce(async () => {
      await db.user.update({ where: { id: resetUser.id }, data: { password: replacement } });
      return { count: 0 };
    });
    try {
      expect((await login(request({ email: resetUser.email, password }))).status).toBe(401);
      expect((await db.user.findUniqueOrThrow({ where: { id: resetUser.id } })).password).toBe(replacement);
    } finally { update.mockRestore(); }
  }, 15_000);

  it("uses new hashes for registration and OTP-authorized password resets", async () => {
    const { POST: register } = await import("@/app/api/auth/register/route");
    const email = `${prefix}-register@example.invalid`;
    expect((await register(request({ name: "Local test buyer", email, password, confirmPassword: password, role: "USER" }))).status).toBe(200);
    let user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user.password).toMatch(/^scrypt\$v1\$/);
    const { issueOtp } = await import("@/lib/otp");
    let otp = "";
    await issueOtp({ userId: user.id, email, purpose: "PASSWORD_RESET" }, async (code) => { otp = code; });
    const { POST: reset } = await import("@/app/api/auth/reset-password/route");
    expect((await reset(request({ email, otp, newPassword: "New reset!123", confirmPassword: "New reset!123" }))).status).toBe(200);
    user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(await verifyPassword("New reset!123", user.password)).toBe(true);
    expect(await db.otpToken.count({ where: { email } })).toBe(0);
  });

  it("requires a valid current password and persists an awaited versioned password change", async () => {
    const user = await buyer();
    (verifyJwtToken as jest.Mock).mockResolvedValue({ sub: user.id });
    const { POST: change } = await import("@/app/api/user/change-password/route");
    const input = { currentPassword: "Incorrect!123", newPassword: "Changed password!123", confirmPassword: "Changed password!123" };
    expect((await change(request(input))).status).toBe(400);
    expect((await change(request({ ...input, currentPassword: password }))).status).toBe(200);
    const updated = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.password).toMatch(/^scrypt\$v1\$/);
    expect(await verifyPassword(input.newPassword, updated.password)).toBe(true);
  });

  it("returns bounded-service overload feedback without rewriting legacy credentials", async () => {
    const user = await buyer();
    const auth = jest.requireMock("@/lib/auth") as typeof import("@/lib/auth");
    const hash = jest.spyOn(auth, "hashPassword").mockRejectedValueOnce(new auth.PasswordWorkloadBusy());
    try {
      const response = await login(request({ email: user.email, password }));
      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("5");
      expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).password).toBe(user.password);
    } finally { hash.mockRestore(); }
  });

  it("runs actual operator CLIs with explicit local credentials and prints only safe inventory", async () => {
    const env = { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL,
      SEED_ADMIN_EMAIL: `${prefix}-cli-admin@example.invalid`, SEED_SELLER_EMAIL: `${prefix}-cli-seller@example.invalid`, SEED_USER_EMAIL: `${prefix}-cli-user@example.invalid`,
      SEED_ADMIN_PASSWORD: password, SEED_SELLER_PASSWORD: password, SEED_USER_PASSWORD: password,
    };
    const run = (script: string, extra = {}) => spawnSync(process.execPath, ["--import", "tsx", script], { cwd: process.cwd(), env: { ...env, ...extra }, encoding: "utf8", timeout: 15_000 });
    const seeded = run("scripts/seed-users-credentials.ts");
    expect(seeded.status).toBe(0);
    expect(seeded.stdout).not.toContain(password);
    const users = await db.user.findMany({ where: { email: { startsWith: `${prefix}-cli-` } } });
    expect(users).toHaveLength(3);
    expect(users.every((user) => user.password?.startsWith("scrypt$v1$"))).toBe(true);
    const provisioned = run("scripts/provision-admin.ts", { SEED_ADMIN_EMAIL: env.SEED_USER_EMAIL, SEED_ADMIN_PASSWORD: "Privately selected!123" });
    expect(provisioned.status).toBe(0);
    expect(provisioned.stdout).not.toContain("Privately selected!123");
    const promoted = await db.user.findUniqueOrThrow({ where: { email: env.SEED_USER_EMAIL } });
    expect(promoted.role).toBe("ADMIN");
    expect(await verifyPassword("Privately selected!123", promoted.password)).toBe(true);
    const inventory = run("scripts/check-passwords.ts");
    expect(inventory.status).toBe(0);
    expect(JSON.parse(inventory.stdout).passwordFormats.current).toBeGreaterThanOrEqual(3);
    expect(inventory.stdout).not.toContain("scrypt$");
    expect(inventory.stdout).not.toContain(prefix);
  }, 30_000);
});
