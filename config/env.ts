import { z } from "zod";

const serverSchema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid connection URL"),
  DIRECT_URL: z.string().url().optional(),
  NEXTAUTH_SECRET: z.string().min(1, "NEXTAUTH_SECRET is required"),
  NEXTAUTH_URL: z.string().url("NEXTAUTH_URL must be a valid URL"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_PUBLIC_URL: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
});

const clientSchema = z.object({
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  NEXT_PUBLIC_GTM_ID: z.string().optional(),
  NEXT_PUBLIC_GA_ID: z.string().optional(),
});

// Environment validation bypassing for build/CI pipelines
const isBuildTime = 
  process.env.NEXT_PHASE === "phase-production-build" || 
  process.env.SKIP_ENV_VALIDATION === "true";

function validateEnv() {
  if (isBuildTime) {
    console.log("ℹ️ Skipping strict environment variables validation during build phase.");
    return {
      server: {} as z.infer<typeof serverSchema>,
      client: {} as z.infer<typeof clientSchema>,
    };
  }

  const serverParsed = serverSchema.safeParse(process.env);
  const clientParsed = clientSchema.safeParse(process.env);

  if (!serverParsed.success) {
    console.error("❌ Invalid Server Environment Variables:", serverParsed.error.format());
    throw new Error("Invalid Server Environment Variables");
  }

  if (!clientParsed.success) {
    console.error("❌ Invalid Client Environment Variables:", clientParsed.error.format());
    throw new Error("Invalid Client Environment Variables");
  }

  // Prevent server-side secrets from being leaked on the client side at runtime
  if (typeof window !== "undefined") {
    throw new Error("❌ Server-side environment variables cannot be accessed on the client.");
  }

  return {
    server: serverParsed.data,
    client: clientParsed.data,
  };
}

export const env = validateEnv();
export const serverEnv = env.server;
export const clientEnv = env.client;
