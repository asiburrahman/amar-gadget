import { randomBytes } from "node:crypto";

export function runtimeFixtureEnvironment(databaseUrl, origin, redis) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/audit_") || url.search) throw new Error("Runtime fixture requires an isolated local audit_* database.");
  const system = Object.fromEntries(["SystemRoot", "WINDIR", "TEMP", "TMP", "PATH", "USERPROFILE"].filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
  return {
    ...system, NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: new URL(origin).port, NEXT_TELEMETRY_DISABLED: "1", NEXT_PHASE: "", SKIP_ENV_VALIDATION: "",
    DATABASE_URL: url.toString(), DIRECT_URL: url.toString(), APP_URL: origin,
    JWT_SECRET: randomBytes(32).toString("hex"), OTP_SECRET: randomBytes(32).toString("hex"),
    TRUSTED_PROXY_SECRET: randomBytes(32).toString("hex"),
    UPSTASH_REDIS_REST_URL: redis.url, UPSTASH_REDIS_REST_TOKEN: redis.token,
    SMTP_HOST: "smtp.example.invalid", SMTP_PORT: "587", SMTP_USER: "local-test-only", SMTP_PASS: randomBytes(32).toString("hex"), SMTP_FROM: "Smoke <smoke@example.invalid>",
    STRIPE_SECRET_KEY: "sk_test_isolated_smoke_only", STRIPE_WEBHOOK_SECRET: "whsec_isolated_smoke_only",
    CHECKOUT_SWEEP_SECRET: randomBytes(32).toString("hex"), CHECKOUT_SWEEP_DATABASE: decodeURIComponent(url.pathname.slice(1)),
    R2_ACCOUNT_ID: "a".repeat(32), R2_ACCESS_KEY_ID: "local-test-only", R2_SECRET_ACCESS_KEY: randomBytes(32).toString("hex"), R2_BUCKET_NAME: "smoke-media", R2_PUBLIC_URL: "https://media.example.invalid",
  };
}
