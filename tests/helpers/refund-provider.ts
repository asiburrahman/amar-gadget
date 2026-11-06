import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import * as stripeModule from "@/lib/stripe/stripe";
/** A provider boundary fixture, never application behavior. All order, stock,
 * ledger, session-version and webhook persistence uses real PostgreSQL. */
export function refundProviderFixture(db: PrismaClient) {
  const stripe = new Stripe("sk_test_isolated_refund_provider"), refunds = new Map<string, Stripe.Refund>(), idempotency = new Map<string, Stripe.Refund>(), disputes = new Map<string, Stripe.Dispute>();
  const state: { mode: "succeeded" | "pending" | "failed" | "throw-after-create" } = { mode: "succeeded" };
  const get = jest.spyOn(stripeModule, "getStripe").mockReturnValue(stripe);
  const payment = jest.spyOn(stripe.paymentIntents, "retrieve").mockImplementation(async (id) => {
    const order = await db.order.findFirstOrThrow({ where: { paymentIntentId: id } });
    return { id, object: "payment_intent", status: "succeeded", amount_received: Math.round(Number(order.total) * 100), currency: "bdt", metadata: { orderId: order.id }, latest_charge: { id: `ch_${id}`, paid: true, disputed: false, currency: "bdt", payment_intent: id } } as never;
  });
  const list = jest.spyOn(stripe.refunds, "list").mockImplementation((params) => Promise.resolve({ data: [...refunds.values()].filter((row) => row.payment_intent === params?.payment_intent), has_more: false, object: "list", url: "/v1/refunds" }) as unknown as ReturnType<typeof stripe.refunds.list>);
  const create = jest.spyOn(stripe.refunds, "create").mockImplementation(async (params, options) => {
    if (!params || !options?.idempotencyKey) throw new Error("Provider create requires a stable key and explicit amount");
    const previous = idempotency.get(options.idempotencyKey); if (previous) return previous as never;
    const row = { id: `re_${randomUUID()}`, object: "refund", created: Math.floor(Date.now() / 1000), amount: params.amount, currency: "bdt", payment_intent: params.payment_intent, metadata: params.metadata, status: state.mode === "pending" ? "pending" : state.mode === "failed" ? "failed" : "succeeded", failure_reason: state.mode === "failed" ? "declined" : null } as unknown as Stripe.Refund;
    refunds.set(row.id, row); idempotency.set(options.idempotencyKey, row);
    if (state.mode === "throw-after-create") { state.mode = "succeeded"; throw new Stripe.errors.StripeConnectionError({ message: "Isolated response loss after provider creation" }); }
    return row as never;
  });
  const retrieve = jest.spyOn(stripe.refunds, "retrieve").mockImplementation(async (id) => { const row = refunds.get(id); if (!row) throw new Error("Unknown isolated provider refund"); return row as never; });
  const dispute = jest.spyOn(stripe.disputes, "retrieve").mockImplementation(async (id) => { const row = disputes.get(id); if (!row) throw new Error("Unknown isolated provider dispute"); return row as never; });
  return { stripe, refunds, disputes, state, create, payment, list, retrieve, dispute,
    restore: () => { payment.mockRestore(); list.mockRestore(); create.mockRestore(); retrieve.mockRestore(); dispute.mockRestore(); get.mockRestore(); },
  };
}
