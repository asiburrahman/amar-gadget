import { z } from "zod";

type Environment = Record<string, string | undefined>;
const emptyToUndefined = (value: unknown) => value === "" ? undefined : value;
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(emptyToUndefined, schema.optional());
const nonempty = z.string().min(1).max(4096);
export const privateSecretSchema = z.string().max(4096).refine((value) => Buffer.byteLength(value) >= 32);
const networkUrl = z.string().url().refine((value) => {
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.hash && (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
  } catch { return false; }
});
const databaseUrl = z.string().url().refine((value) => {
  try { const url = new URL(value); return ["postgres:", "postgresql:"].includes(url.protocol) && Boolean(url.hostname) && url.pathname.length > 1; }
  catch { return false; }
});
const sender = z.string().trim().min(1).max(320).refine((value) => !/[\r\n]/.test(value) && z.email().safeParse(value.match(/<([^<>]+)>$/)?.[1] ?? value).success);
const smtpHost = z.string().trim().min(1).max(253).regex(/^[A-Za-z0-9.-]+$/);
const smtpUser = z.string().trim().min(1).max(4096);

export const runtimeFields = {
  DATABASE_URL: databaseUrl,
  DIRECT_URL: optional(databaseUrl),
  JWT_SECRET: privateSecretSchema,
  OTP_SECRET: privateSecretSchema,
  TRUSTED_PROXY_SECRET: optional(privateSecretSchema),
  APP_URL: networkUrl.refine((value) => { try { const url = new URL(value); return url.pathname === "/" && !url.search; } catch { return false; } }),
  UPSTASH_REDIS_REST_URL: optional(networkUrl),
  UPSTASH_REDIS_REST_TOKEN: optional(nonempty),
  SMTP_HOST: optional(smtpHost),
  SMTP_PORT: z.preprocess((value) => value === undefined || value === "" ? 587 : Number(value), z.number().int().min(1).max(65535)),
  SMTP_USER: optional(smtpUser), SMTP_PASS: optional(nonempty), SMTP_FROM: optional(sender),
  STRIPE_SECRET_KEY: optional(z.string().regex(/^sk_(?:test|live)_.+/)),
  STRIPE_WEBHOOK_SECRET: optional(z.string().regex(/^whsec_.+/)),
  R2_ACCOUNT_ID: optional(z.string().regex(/^[a-fA-F0-9]{32}$/)),
  R2_ACCESS_KEY_ID: optional(nonempty), R2_SECRET_ACCESS_KEY: optional(nonempty),
  R2_BUCKET_NAME: optional(z.string().min(1).max(63).regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/)),
  R2_PUBLIC_URL: optional(networkUrl),
  CHECKOUT_SWEEP_SECRET: optional(privateSecretSchema),
  CHECKOUT_SWEEP_DATABASE: optional(z.string().min(1).max(63)),
};
const runtimeSchema = z.object(runtimeFields);
export type RuntimeConfig = z.infer<typeof runtimeSchema>;

/** Errors expose field names only, never input values or nested Zod errors. */
export class RuntimeConfigurationError extends Error {
  constructor(readonly fields: string[]) { super(`Invalid runtime configuration: ${[...new Set(fields)].sort().join(", ")}.`); }
}
function parse<T extends z.ZodType>(schema: T, values: unknown): z.infer<T> {
  const result = schema.safeParse(values);
  if (!result.success) throw new RuntimeConfigurationError(result.error.issues.map((issue) => String(issue.path[0] ?? "configuration")));
  return result.data;
}
export function readPrivateSecret(name: "JWT_SECRET" | "OTP_SECRET" | "TRUSTED_PROXY_SECRET", values: Environment = process.env) {
  return parse(z.object({ [name]: privateSecretSchema }), { [name]: values[name] })[name] as string;
}
export function readDatabaseConfig(values: Environment = process.env) {
  return parse(z.object({ DATABASE_URL: runtimeFields.DATABASE_URL, DIRECT_URL: runtimeFields.DIRECT_URL }), values);
}
export function readRedisConfig(values: Environment = process.env) {
  const result = parse(z.object({ UPSTASH_REDIS_REST_URL: runtimeFields.UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN: runtimeFields.UPSTASH_REDIS_REST_TOKEN }), values);
  if (!result.UPSTASH_REDIS_REST_URL && !result.UPSTASH_REDIS_REST_TOKEN) return null;
  if (!result.UPSTASH_REDIS_REST_URL || !result.UPSTASH_REDIS_REST_TOKEN) throw new RuntimeConfigurationError(["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]);
  return { url: result.UPSTASH_REDIS_REST_URL, token: result.UPSTASH_REDIS_REST_TOKEN };
}
export function readMailTransportConfig(values: Environment = process.env) {
  return parse(z.object({ SMTP_HOST: smtpHost, SMTP_PORT: runtimeFields.SMTP_PORT, SMTP_USER: smtpUser, SMTP_PASS: nonempty }), values);
}
export function readMailSender(values: Environment = process.env) {
  return parse(z.object({ SMTP_FROM: sender }), values).SMTP_FROM;
}
export function readApplicationOrigin(values: Environment = process.env) {
  return new URL(parse(z.object({ APP_URL: runtimeFields.APP_URL }), values).APP_URL).origin;
}
export function readStripeSecret(values: Environment = process.env) {
  return parse(z.object({ STRIPE_SECRET_KEY: z.string().regex(/^sk_(?:test|live)_.+/) }), values).STRIPE_SECRET_KEY;
}
export function readStripeWebhookSecret(values: Environment = process.env) {
  return parse(z.object({ STRIPE_WEBHOOK_SECRET: z.string().regex(/^whsec_.+/) }), values).STRIPE_WEBHOOK_SECRET;
}
export function readSweepConfig(values: Environment = process.env) {
  return parse(z.object({ CHECKOUT_SWEEP_SECRET: privateSecretSchema, CHECKOUT_SWEEP_DATABASE: z.string().min(1).max(63) }), values);
}
export function readStorageConfig(values: Environment = process.env) {
  const result = parse(z.object({ R2_ACCOUNT_ID: runtimeFields.R2_ACCOUNT_ID, R2_ACCESS_KEY_ID: runtimeFields.R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY: runtimeFields.R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME: runtimeFields.R2_BUCKET_NAME, R2_PUBLIC_URL: runtimeFields.R2_PUBLIC_URL }), values);
  const missing = Object.entries(result).filter(([, value]) => !value).map(([key]) => key);
  for (const key of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME", "R2_PUBLIC_URL"]) if (!(key in result)) missing.push(key);
  if (missing.length) throw new RuntimeConfigurationError(missing);
  return result as Required<typeof result>;
}

export function validateRuntimeConfig(values: Environment = process.env): RuntimeConfig {
  // NODE_ENV/Next phase are not bypass permissions. SKIP_ENV_VALIDATION is ignored.
  const config = parse(runtimeSchema, values);
  const groups = [
    ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
    ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"],
    ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "CHECKOUT_SWEEP_SECRET", "CHECKOUT_SWEEP_DATABASE"],
    ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME", "R2_PUBLIC_URL"],
  ] as const;
  const missing: string[] = [];
  if (values.NODE_ENV === "production" && !config.TRUSTED_PROXY_SECRET) missing.push("TRUSTED_PROXY_SECRET");
  if (config.TRUSTED_PROXY_SECRET && [config.JWT_SECRET, config.OTP_SECRET, config.CHECKOUT_SWEEP_SECRET].includes(config.TRUSTED_PROXY_SECRET)) missing.push("TRUSTED_PROXY_SECRET");
  for (const group of groups) {
    const required = values.NODE_ENV === "production" || group.some((key) => Boolean(config[key]));
    if (required) for (const key of group) if (!config[key]) missing.push(key);
  }
  if (config.JWT_SECRET === config.OTP_SECRET) missing.push("OTP_SECRET");
  if (config.CHECKOUT_SWEEP_SECRET && [config.JWT_SECRET, config.OTP_SECRET].includes(config.CHECKOUT_SWEEP_SECRET)) missing.push("CHECKOUT_SWEEP_SECRET");
  if (config.CHECKOUT_SWEEP_DATABASE && decodeURIComponent(new URL(config.DATABASE_URL).pathname.slice(1)) !== config.CHECKOUT_SWEEP_DATABASE) missing.push("CHECKOUT_SWEEP_DATABASE");
  if (missing.length) throw new RuntimeConfigurationError(missing);
  return config;
}
