import { z } from "zod";
const uuid = z.string().uuid();
const version = z.number().int().min(1).max(2147483646);
const note = z.string().trim().min(5).max(500).refine((s) => !/[\u0000-\u001f\u007f]/.test(s), "Use plain text without control characters.");
const minor = z.number().int().min(0).max(9_999_999_999);
const items = z.array(z.object({ itemId: uuid, quantity: z.number().int().min(1).max(100) }).strict()).min(1).max(100).refine((xs) => new Set(xs.map((x) => x.itemId)).size === xs.length);
export const refundRequestSchema = z.object({ orderId: uuid, version, requestId: uuid, reason: note, selection: z.union([z.literal("FULL"), items]) }).strict();
export const refundQuoteSchema = refundRequestSchema.omit({ requestId: true, reason: true });
export const refundActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("quote"), request: refundQuoteSchema }).strict(),
  z.object({ action: z.literal("request"), request: refundRequestSchema }).strict(),
  z.object({ action: z.literal("process"), refundId: uuid, version }).strict(),
  z.object({ action: z.literal("confirm-cod"), refundId: uuid, version, moneyReturned: z.literal(true), method: z.enum(["CASH", "BKASH", "NAGAD", "BANK", "OTHER"]), reference: z.string().trim().min(3).max(120).refine((s) => !/[\u0000-\u001f\u007f]/.test(s)) }).strict(),
  z.object({ action: z.literal("cancel-request"), refundId: uuid, version, reason: note }).strict(),
  z.object({ action: z.literal("recover-missing"), refundId: uuid, version, evidence: note }).strict(),
  z.object({ action: z.literal("resolve-review"), orderId: uuid, version, evidence: note }).strict(),
  z.object({ action: z.literal("pricing"), orderId: uuid, version, shippingCents: minor, evidence: note }).strict(),
  z.object({ action: z.literal("return"), orderId: uuid, itemId: uuid, version, requestId: uuid, quantity: z.number().int().min(1).max(100), inspectedAndAccepted: z.literal(true), evidence: note }).strict(),
  z.object({ action: z.literal("allocate-external"), refundId: uuid, version, evidence: note, shippingCents: minor, lines: z.array(z.object({ itemId: uuid, quantity: z.number().int().min(0).max(100), amountCents: minor }).strict()).max(100).refine((xs) => new Set(xs.map((x) => x.itemId)).size === xs.length) }).strict(),
]);
export const refundQuerySchema = z.object({ orderId: uuid, page: z.coerce.number().int().min(1).max(1_000_000).default(1), cursor: uuid.optional(), requestId: uuid.optional() }).strict();
export type RefundAction = z.infer<typeof refundActionSchema>;
