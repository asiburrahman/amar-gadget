import { parseCommissionPercent, settlementMutationSchema, settlementQuerySchema } from "@/lib/validations/settlement";
const identity = { requestId: "00000000-0000-4000-8000-000000000001", reason: "Verified external payout or commercial policy", confirmed: true };
const global = { ...identity, action: "save-policy", scope: "GLOBAL", sellerId: null, version: 0, terms: { commissionBps: 1250, shippingRecipient: "SELLER" } };
it("requires explicit global terms and permits seller overrides or explicit inheritance without defaults", () => {
  expect(settlementMutationSchema.parse(global)).toMatchObject({ terms: { commissionBps: 1250 } });
  expect(settlementMutationSchema.safeParse({ ...global, terms: null }).success).toBe(false);
  expect(settlementMutationSchema.safeParse({ ...global, sellerId: "seller" }).success).toBe(false);
  expect(settlementMutationSchema.safeParse({ ...global, scope: "SELLER", sellerId: "seller", terms: null }).success).toBe(true);
  expect(settlementMutationSchema.safeParse({ ...global, scope: "SELLER" }).success).toBe(false);
});
it("requires separate transfer confirmation/reference or an explicit declaration that no money was sent", () => {
  const payout = { ...identity, action: "start-payout", sellerId: "seller", amountCents: "9007199254740993", method: "Bank transfer" }; expect(settlementMutationSchema.parse(payout)).toMatchObject({ amountCents: "9007199254740993" });
  for (const amountCents of ["0", "-1", "01", "1.5", "1e3", "9999999999999999999", 1000]) expect(settlementMutationSchema.safeParse({ ...payout, amountCents }).success).toBe(false);
  expect(settlementMutationSchema.safeParse({ ...identity, action: "confirm-payout", payoutId: "payout", version: 1 }).success).toBe(false);
  expect(settlementMutationSchema.safeParse({ ...identity, action: "cancel-payout", payoutId: "payout", version: 1 }).success).toBe(false);
  expect(settlementMutationSchema.safeParse({ ...identity, action: "cancel-payout", payoutId: "payout", version: 1, noMoneySent: true }).success).toBe(true);
});
it("rejects actor, balance and policy injection, stale revision types and control characters", () => {
  for (const patch of [{ actorId: "admin" }, { balanceCents: "1000" }, { confirmed: false }, { version: "1" }, { reason: "forged\nline" }, { terms: { commissionBps: 1000, shippingRecipient: "SELLER", availableImmediately: false } }]) expect(settlementMutationSchema.safeParse({ ...global, ...patch }).success).toBe(false);
  expect(settlementQuerySchema.safeParse({ sellerId: "../foreign", page: 1 }).success).toBe(false); expect(settlementQuerySchema.safeParse({ page: 0 }).success).toBe(false);
});
it("parses user-entered percentage exactly and rejects ambiguous or out-of-range values", () => {
  for (const [input, expected] of [["0", 0], ["0.01", 1], ["2.5", 250], ["12.34", 1234], ["100.00", 10000]] as const) expect(parseCommissionPercent(input)).toBe(expected);
  for (const input of ["", "01", "1e1", "-0", "1.001", "100.01", "999", ".5", "NaN"]) expect(() => parseCommissionPercent(input)).toThrow();
});
