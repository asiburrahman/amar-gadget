import { z } from "zod";
import { NOTIFICATION_KINDS } from "@/lib/notification-policy";
const version = z.number().int().min(0).max(2147483646), id = z.string().uuid();
const identity = { id, version };
export const notificationQuerySchema = z.object({ filter: z.enum(["ALL", "UNREAD", "READ"]).default("ALL"), kind: z.enum(["ALL", ...NOTIFICATION_KINDS]).default("ALL"), page: z.coerce.number().int().min(1).max(1_000_000).default(1) }).strict();
export const notificationMutationSchema = z.discriminatedUnion("action", [
  z.object({ ...identity, action: z.literal("read") }).strict(),
  z.object({ ...identity, action: z.literal("unread") }).strict(),
  z.object({ action: z.literal("read-page"), entries: z.array(z.object(identity).strict()).min(1).max(20).refine((entries) => new Set(entries.map((entry) => entry.id)).size === entries.length) }).strict(),
]);
export const NOTIFICATION_QUEUE_STATES = ["READY", "PROCESSING", "RETRY", "DELIVERED", "SKIPPED", "DEAD"] as const;
export const notificationQueueQuerySchema = z.object({ state: z.enum(["ALL", "PROBLEMS", ...NOTIFICATION_QUEUE_STATES]).default("PROBLEMS"), page: z.coerce.number().int().min(1).max(1_000_000).default(1) }).strict();
export const notificationRetrySchema = z.object({ id, version: version.refine((value) => value > 0), reason: z.string().trim().min(5).max(500).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Use a single-line retry reason.") }).strict();
export type NotificationMutation = z.infer<typeof notificationMutationSchema>;
