import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { signIngress } from "../lib/ingress-protocol.cjs";
import { createFinancialSmokeDatabase } from "./testing/finance-database.mjs";
import { startStandaloneFixture } from "./testing/standalone-fixture.mjs";
import { startRedisRestFixture } from "./testing/redis-rest-fixture.mjs";
import { startSmtpFixture } from "./testing/smtp-fixture.mjs";
import { requestHttp } from "./testing/http-request.mjs";
let phase = "isolated OTP database setup";
async function main() {
  const fixture = await createFinancialSmokeDatabase(), db = fixture.db; let child, redis, smtp, sequence = 1;
  try {
    smtp = await startSmtpFixture(); redis = await startRedisRestFixture(randomBytes(32).toString("hex"));
    const secret = randomBytes(32).toString("hex"), password = "Aa!9" + randomBytes(24).toString("hex"), nextPassword = "Bb!8" + randomBytes(24).toString("hex");
    child = await startStandaloneFixture(fixture.url, redis, { TRUSTED_PROXY_SECRET: secret, SMTP_HOST: smtp.host, SMTP_PORT: String(smtp.port), SMTP_USER: smtp.user, SMTP_PASS: smtp.password, SMTP_FROM: "Isolated OTP <otp@example.invalid>", NODE_EXTRA_CA_CERTS: smtp.caPath });
    const send = (target, body, cookie) => {
      const method = body === undefined ? "GET" : "POST";
      return requestHttp(child.origin + target, { method, headers: { ...signIngress({ secret, origin: child.origin, ip: `127.0.0.${sequence++}`, method, target }), ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { Origin: child.origin, "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    };
    const register = (email) => send("/api/auth/register", { name: "Isolated OTP account", email, password, confirmPassword: password, role: "USER" });
    const codeFromMail = (email) => {
      const message = smtp.messages.filter((entry) => entry.recipient === email).at(-1); assert.ok(message);
      const text = message.raw.replace(/=\r\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
      const code = text.match(/code is (\d{6})\b/)?.[1]; assert.ok(code); return code;
    };
    const storedClock = async (userId, purpose) => {
      const token = await db.otpToken.findUniqueOrThrow({ where: { userId_purpose: { userId, purpose } } });
      assert.ok(Math.abs(token.createdAt.getTime() - Date.now()) < 10_000); assert.ok(Math.abs(token.deliveredAt.getTime() - Date.now()) < 10_000);
      assert.equal(token.expiresAt.getTime() - token.createdAt.getTime(), 600_000); assert.ok(/^[a-f0-9]{64}$/.test(token.codeHash)); return token;
    };
    phase = "compiled registration and real local STARTTLS OTP transport";
    const email = `${randomUUID()}@otp-smoke.example.invalid`, registered = await register(email); assert.equal(registered.status, 200);
    const account = await db.user.findUniqueOrThrow({ where: { email } }), original = await storedClock(account.id, "REGISTRATION");
    const mailCount = smtp.messages.length; assert.equal((await send("/api/auth/resend-otp", { email })).status, 200); assert.equal(smtp.messages.length, mailCount);
    assert.equal((await db.otpToken.findUniqueOrThrow({ where: { id: original.id } })).codeHash, original.codeHash);
    phase = "compiled signup verification, single-use code and actual session";
    const code = codeFromMail(email), verified = await send("/api/auth/verify-otp", { email, otp: code, password }); assert.equal(verified.status, 200);
    const cookie = verified.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie); assert.equal((await send("/api/auth/me", undefined, cookie)).status, 200);
    assert.equal((await send("/api/auth/verify-otp", { email, otp: code, password })).status, 400); assert.equal(await db.otpToken.count({ where: { userId: account.id } }), 0);
    phase = "compiled password reset UTC timing and revocation";
    assert.equal((await send("/api/auth/forgot-password", { email })).status, 200); await storedClock(account.id, "PASSWORD_RESET");
    const reset = await send("/api/auth/reset-password", { email, otp: codeFromMail(email), newPassword: nextPassword, confirmPassword: nextPassword }); assert.equal(reset.status, 200);
    assert.deepEqual(await (await send("/api/auth/me", undefined, cookie)).json(), { success: false, user: null });
    assert.equal((await send("/api/auth/login", { email, password: nextPassword })).status, 200);
    phase = "compiled expired OTP rejection";
    const expiredEmail = `${randomUUID()}@otp-smoke.example.invalid`; assert.equal((await register(expiredEmail)).status, 200);
    const expiredUser = await db.user.findUniqueOrThrow({ where: { email: expiredEmail } });
    await db.otpToken.updateMany({ where: { userId: expiredUser.id }, data: { expiresAt: new Date(0) } });
    assert.equal((await send("/api/auth/verify-otp", { email: expiredEmail, otp: codeFromMail(expiredEmail), password })).status, 400); assert.equal((await db.user.findUniqueOrThrow({ where: { id: expiredUser.id } })).isVerified, false);
    phase = "compiled schema-clock guard fails closed before delivery";
    const blockedEmail = `${randomUUID()}@otp-smoke.example.invalid`, before = smtp.messages.length;
    await db.$executeRawUnsafe('ALTER TABLE "OtpToken" DISABLE TRIGGER "OtpToken_utc_clock_guard"');
    try {
      assert.equal((await register(blockedEmail)).status, 503); assert.equal(smtp.messages.length, before);
      // Startup now probes actual readiness, populating its documented five-
      // second cache. The mutation endpoint fails immediately; readiness must
      // observe the disabled guard after that bounded cache expires.
      await delay(5100);
      assert.equal((await send("/api/health/ready")).status, 503);
    } finally { await db.$executeRawUnsafe('ALTER TABLE "OtpToken" ENABLE TRIGGER "OtpToken_utc_clock_guard"'); }
    assert.equal((await register(blockedEmail)).status, 200); assert.equal(smtp.messages.length, before + 1);
    await delay(5100); assert.equal((await send("/api/health/ready")).status, 200);
    assert.ok(smtp.counters().tlsSessions >= 4); assert.equal(smtp.counters().plaintextAuth, 0);
    return { actualStartTlsOtpDeliveryAndUtcTtl: "PASS", compiledVerificationSingleUseAndResendBudget: "PASS", compiledPasswordResetAndSessionRevocation: "PASS", compiledExpiredCodeRejection: "PASS", compiledClockSchemaGateAndRecovery: "PASS" };
  } finally { await child?.stop(); await smtp?.close(); await redis?.close(); await fixture.close(); }
}
main().then((result) => console.log(JSON.stringify(result))).catch(() => { console.error(`OTP clock smoke failed during ${phase}. Private transport output, codes and credentials were not published.`); process.exitCode = 1; });
