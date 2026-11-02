import { z } from "zod";
const id = z.string().regex(/^[A-Za-z0-9-]{1,64}$/), version = z.number().int().min(1).max(2147483646), requestId = z.string().uuid().transform((value) => value.toLowerCase());
const identity = { id, version, requestId, reason: z.string().trim().min(5).max(300).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Use a single line of plain text for the audit reason."), confirmed: z.literal(true) };
export const accountAdminMutationSchema = z.discriminatedUnion("action", [
  z.object({ ...identity, action: z.literal("role"), role: z.enum(["USER", "MEMBER", "ADMIN"]) }).strict(),
  z.object({ ...identity, action: z.literal("seller-status"), sellerStatus: z.enum(["APPROVED", "PENDING", "BLOCKED", "REJECTED"]) }).strict(),
  z.object({ ...identity, action: z.literal("revoke-sessions") }).strict(),
]);
export const accountAdminQuerySchema = z.object({
  scope: z.enum(["accounts", "members"]).default("accounts"), mode: z.enum(["list", "record", "history"]).default("list"), id: id.optional(), requestId: requestId.optional(),
  q: z.string().trim().max(120).default(""), role: z.enum(["ALL", "USER", "MEMBER", "ADMIN"]).default("ALL"), sellerStatus: z.enum(["ALL", "APPROVED", "PENDING", "BLOCKED", "REJECTED"]).default("ALL"), verified: z.enum(["ALL", "YES", "NO"]).default("ALL"),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
}).strict().refine((value) => value.mode === "list" || !!value.id).refine((value) => value.scope !== "members" || ["ALL", "MEMBER"].includes(value.role));
export type AccountAdminMutation = z.infer<typeof accountAdminMutationSchema>;
