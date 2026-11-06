import { z } from "zod";
import { AGGREGATE_ORDER_STATES, FULFILLMENT_STATES, type AggregateOrderState, type FulfillmentState } from "@/lib/fulfillment-policy";
const text = (minimum: number, maximum: number) => z.string().trim().min(minimum).max(maximum).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Use plain text without control characters.");
export const fulfillmentVersionSchema = z.number().int().min(1).max(2147483646);
const identity = { fulfillmentId: z.string().uuid(), version: fulfillmentVersionSchema };
const tracking = { carrier: text(2, 80), trackingNumber: text(2, 120) };
export const fulfillmentMutationSchema = z.discriminatedUnion("action", [
  z.object({ ...identity, action: z.literal("ship"), ...tracking }).strict(),
  z.object({ ...identity, action: z.literal("tracking"), ...tracking }).strict(),
  z.object({ ...identity, action: z.literal("deliver"), codMoneyReceived: z.boolean() }).strict(),
  z.object({ ...identity, action: z.literal("collect-cod"), codMoneyReceived: z.literal(true) }).strict(),
]);
export type FulfillmentMutation = z.infer<typeof fulfillmentMutationSchema>;
export const wholeOrderMutationSchema = z.object({ orderId: z.string().uuid(), ownerId: z.string().min(1).max(64), version: fulfillmentVersionSchema, action: z.enum(["confirm", "cancel"]) }).strict();
export const fulfillmentQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  status: z.enum(["ALL", ...FULFILLMENT_STATES]).default("ALL"),
  orderId: z.string().uuid().optional(),
}).strict();
export const orderFulfillmentQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  status: z.enum(["ALL", ...AGGREGATE_ORDER_STATES]).default("ALL"),
}).strict();
export const FULFILLMENT_PAGE_SIZE = 20;
export type FulfillmentItem = { id: string; productId: string; name: string; imageUrl: string | null; quantity: number; unitPrice: number };
export type ShipmentHistoryEntry = { id: string; kind: string; status: FulfillmentState; carrier: string | null; trackingNumber: string | null; occurredAt: string | null; recordedAt: string };
/** No buyer account ID/email, other vendors' items or full order totals. */
export type SellerFulfillment = {
  id: string; orderId: string; orderTrackingCode: string | null; status: FulfillmentState; version: number;
  orderStatus: AggregateOrderState; paymentMethod: "COD" | "STRIPE"; paymentStatus: string;
  codCollectedAt: string | null;
  recipientAddress: string | null; recipientPhone: string | null;
  carrier: string | null; trackingNumber: string | null; shippedAt: string | null; deliveredAt: string | null;
  legacySnapshot: boolean; createdAt: string; items: FulfillmentItem[];
};
export type CustomerFulfillment = {
  id: string; status: FulfillmentState; carrier: string | null; trackingNumber: string | null;
  shippedAt: string | null; deliveredAt: string | null; legacySnapshot: boolean; itemIds: string[];
};
