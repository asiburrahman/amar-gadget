import { z } from "zod";

export const NEWSLETTER_CONSENT_VERSION = "newsletter-v1";
export const newsletterEmailSchema = z.string().trim().max(254).email().transform((value) => value.toLowerCase());
export const newsletterSubscribeSchema = z.object({
  requestId: z.string().uuid(),
  email: newsletterEmailSchema,
  consent: z.literal(true),
}).strict();
export const newsletterTokenSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/i);
export const newsletterTokenMutationSchema = z.object({ token: newsletterTokenSchema }).strict();
export const NEWSLETTER_STATES = ["PENDING", "ACTIVE", "UNSUBSCRIBED"] as const;
export const newsletterQueueSchema = z.object({
  status: z.enum(["ALL", ...NEWSLETTER_STATES]).default("ALL"),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
}).strict();
export type NewsletterSubscribe = z.infer<typeof newsletterSubscribeSchema>;
export const NEWSLETTER_DELIVERY_STATES = ["READY", "SENDING", "SENT", "FAILED", "SUPPRESSED", "DEAD"] as const;
export const newsletterAdminQuerySchema = z.discriminatedUnion("mode", [
  newsletterQueueSchema.extend({ mode: z.literal("SUBSCRIBERS") }),
  z.object({ mode: z.literal("DELIVERIES"), state: z.enum(["ALL", ...NEWSLETTER_DELIVERY_STATES]).default("ALL"), page: z.coerce.number().int().min(1).max(1_000_000).default(1) }).strict(),
]);
