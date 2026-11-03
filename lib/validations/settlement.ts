import { z } from "zod";
import { catalogIdSchema } from "@/lib/validations/product";
const version = z.number().int().min(1).max(2147483646);
const requestId = z.string().uuid().transform((value) => value.toLowerCase());
const plainLine = (min: number, max: number) => z.string().trim().min(min).max(max).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Use a single line of plain text.");
const identity = { requestId, reason: plainLine(5, 500), confirmed: z.literal(true) };
export const settlementTermsSchema = z.object({ commissionBps: z.number().int().min(0).max(10_000), shippingRecipient: z.enum(["SELLER", "PLATFORM"]) }).strict();
export const settlementMutationSchema = z.discriminatedUnion("action", [
  z.object({ ...identity, action: z.literal("save-policy"), scope: z.enum(["GLOBAL", "SELLER"]), sellerId: catalogIdSchema.nullable(), version: version.or(z.literal(0)), terms: settlementTermsSchema.nullable() }).strict(),
  z.object({ ...identity, action: z.literal("adopt-policy"), fulfillmentId: catalogIdSchema, version, policyId: catalogIdSchema }).strict(),
  // Canonical integer-paisa strings preserve aggregate balances beyond JS's
  // safe-integer boundary. BigInt conversion happens after validation on server.
  z.object({ ...identity, action: z.literal("start-payout"), sellerId: catalogIdSchema, amountCents: z.string().regex(/^[1-9][0-9]{0,17}$/, "Enter a positive integer-paisa amount."), method: plainLine(2, 30) }).strict(),
  z.object({ ...identity, action: z.literal("confirm-payout"), payoutId: catalogIdSchema, version, reference: plainLine(3, 120) }).strict(),
  z.object({ ...identity, action: z.literal("cancel-payout"), payoutId: catalogIdSchema, version, noMoneySent: z.literal(true) }).strict(),
]).superRefine((input, context) => {
  if (input.action === "save-policy" && ((input.scope === "GLOBAL" && (!input.terms || input.sellerId !== null)) || (input.scope === "SELLER" && !input.sellerId))) context.addIssue({ code: "custom", message: "Global policies need explicit terms; seller overrides need a seller, or explicit null terms to restore inheritance." });
});
export const settlementQuerySchema = z.object({ mode: z.enum(["overview", "policies", "shipments", "ledger", "payouts"]).default("overview"), sellerId: catalogIdSchema.optional(), page: z.coerce.number().int().min(1).max(1_000_000).default(1), requestId: requestId.optional() }).strict();
export type SettlementMutation = z.infer<typeof settlementMutationSchema>;
export const settlementAbandonSchema = z.object({ action: z.literal("abandon-request"), originalIntent: settlementMutationSchema, confirmed: z.literal(true) }).strict();
export const settlementRequestSchema = z.union([settlementMutationSchema, settlementAbandonSchema]);
export type SettlementRequest = z.infer<typeof settlementRequestSchema>;
/** Parse the administrator's displayed percentage without floating-point rounding. */
export function parseCommissionPercent(value: string) {
  const match = /^(0|[1-9][0-9]{0,2})(?:\.([0-9]{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error("Use a percentage from 0 to 100 with at most two decimal places.");
  const basisPoints = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (basisPoints > 10_000) throw new Error("Commission cannot exceed 100 percent."); return basisPoints;
}
