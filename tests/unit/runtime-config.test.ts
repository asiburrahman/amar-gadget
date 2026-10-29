import { validateRuntimeConfig, readPrivateSecret, readMailTransportConfig, readMailSender, RuntimeConfigurationError } from "../../config/runtime";
import { readdirSync } from "node:fs";
import { REQUIRED_SCHEMA_MIGRATION } from "../../lib/database-schema";

const configured = () => ({
  NODE_ENV: "production", DATABASE_URL: "postgresql://local:local@127.0.0.1:5432/audit_config", APP_URL: "https://store.example.invalid",
  JWT_SECRET: "j".repeat(32), OTP_SECRET: "o".repeat(32),
  UPSTASH_REDIS_REST_URL: "https://redis.example.invalid", UPSTASH_REDIS_REST_TOKEN: "local-test-redis-token",
  SMTP_HOST: "smtp.example.invalid", SMTP_USER: "local-test-user", SMTP_PASS: "local-test-password", SMTP_FROM: "Store <mail@example.invalid>",
  STRIPE_SECRET_KEY: "sk_test_local_fixture", STRIPE_WEBHOOK_SECRET: "whsec_local_fixture",
  R2_ACCOUNT_ID: "a".repeat(32), R2_ACCESS_KEY_ID: "local-test-access", R2_SECRET_ACCESS_KEY: "local-test-secret", R2_BUCKET_NAME: "store-media", R2_PUBLIC_URL: "https://media.example.invalid",
  CHECKOUT_SWEEP_SECRET: "s".repeat(32), CHECKOUT_SWEEP_DATABASE: "audit_config",
});
it("accepts complete production configuration without unused NextAuth/OAuth secrets", () => {
  expect(validateRuntimeConfig(configured()).SMTP_PORT).toBe(587);
});
it.each(["DATABASE_URL", "APP_URL", "JWT_SECRET", "OTP_SECRET", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "SMTP_PASS", "SMTP_FROM", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "R2_PUBLIC_URL", "CHECKOUT_SWEEP_SECRET"])("fails production configuration with missing %s even when old bypass flags are supplied", (key) => {
  const values: Record<string, string> = { ...configured(), SKIP_ENV_VALIDATION: "true", NEXT_PHASE: "phase-production-build", [key]: "" };
  expect(() => validateRuntimeConfig(values)).toThrow(RuntimeConfigurationError);
});
it.each(["http://store.example.invalid", "javascript:alert(1)", "https://user:password@example.invalid", "https://store.example.invalid/path", "not a URL"])("rejects an invalid canonical origin %s without throwing a URL parser error", (APP_URL) => {
  expect(() => validateRuntimeConfig({ ...configured(), APP_URL })).toThrow(RuntimeConfigurationError);
});
it("uses the same byte-length rule for signing/OTP/runtime and rejects key reuse", () => {
  expect(() => readPrivateSecret("JWT_SECRET", { JWT_SECRET: "a".repeat(31) })).toThrow(RuntimeConfigurationError);
  expect(() => readPrivateSecret("OTP_SECRET", { OTP_SECRET: "a".repeat(31) })).toThrow(RuntimeConfigurationError);
  expect(readPrivateSecret("JWT_SECRET", { JWT_SECRET: "ক".repeat(11) })).toBe("ক".repeat(11));
  expect(() => validateRuntimeConfig({ ...configured(), OTP_SECRET: configured().JWT_SECRET })).toThrow(RuntimeConfigurationError);
});
it("returns only field names on invalid private configuration", () => {
  const privateValue = "private-value-must-never-appear";
  try { validateRuntimeConfig({ ...configured(), JWT_SECRET: privateValue }); throw new Error("Bad secret accepted"); }
  catch (error) { expect(error).toBeInstanceOf(RuntimeConfigurationError); expect(String(error)).toContain("JWT_SECRET"); expect(String(error)).not.toContain(privateValue); }
});
it("validates SMTP sender/port consistently with the transport and rejects header injection", () => {
  expect(readMailTransportConfig({ ...configured(), SMTP_PORT: "465" }).SMTP_PORT).toBe(465);
  expect(() => readMailTransportConfig({ ...configured(), SMTP_PORT: "bad" })).toThrow(RuntimeConfigurationError);
  expect(() => readMailSender({ SMTP_FROM: "Store <mail@example.invalid>\r\nBcc: extra@example.invalid" })).toThrow(RuntimeConfigurationError);
});
it("rejects mixed partial service settings in development and mismatched sweep databases", () => {
  const core = { NODE_ENV: "development", DATABASE_URL: configured().DATABASE_URL, JWT_SECRET: configured().JWT_SECRET, OTP_SECRET: configured().OTP_SECRET, APP_URL: "http://localhost:3000" };
  expect(validateRuntimeConfig(core).APP_URL).toBe("http://localhost:3000");
  expect(() => validateRuntimeConfig({ ...core, UPSTASH_REDIS_REST_URL: "https://redis.example.invalid" })).toThrow(RuntimeConfigurationError);
  expect(() => validateRuntimeConfig({ ...configured(), CHECKOUT_SWEEP_DATABASE: "different_target" })).toThrow(RuntimeConfigurationError);
});
it("keeps the readiness requirement aligned with the latest checked-in migration", () => {
  const migrations = readdirSync("prisma/migrations", { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  expect(REQUIRED_SCHEMA_MIGRATION).toBe(migrations[migrations.length - 1]);
});
