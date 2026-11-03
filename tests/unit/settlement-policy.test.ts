import { allocateSettlementCents, calculateSellerSettlement, commissionCents, validateSettlementTerms, type SettlementOrderInput, type SettlementShipmentInput } from "@/lib/settlement-policy";
const terms = { commissionBps: 1000, shippingRecipient: "SELLER" as const };
const order = (changes: Partial<SettlementOrderInput> = {}): SettlementOrderInput => ({ status: "DELIVERED", paymentMethod: "COD", paymentStatus: "UNPAID", goodsCents: BigInt(10000), shippingCents: BigInt(1500), shippingRefundedCents: BigInt(0), refundState: "NONE", financialReviewReason: null, reservationReviewReason: null, disputeStatus: "NONE", disputeAmountCents: BigInt(0), ...changes });
const shipment = (changes: Partial<SettlementShipmentInput> = {}): SettlementShipmentInput => ({ id: "shipment-a", sellerId: "seller-a", status: "DELIVERED", codCollected: true, grossCents: BigInt(12500), netCents: BigInt(10000), retainedCents: BigInt(10000), terms, ...changes });
const single = (o = order(), s = shipment()) => calculateSellerSettlement(o, [s]).shipments[0];
it("uses discounted goods, excludes shipping from commission and honors each actual configured recipient/rate", () => {
  expect(single()).toMatchObject({ commissionCents: BigInt(1000), goodsCents: BigInt(10000), shippingCents: BigInt(1500), availableCents: BigInt(10500), holds: [] });
  expect(single(order(), shipment({ terms: { commissionBps: 2500, shippingRecipient: "PLATFORM" } })).availableCents).toBe(BigInt(7500));
  expect(single(order(), shipment({ terms: { commissionBps: 0, shippingRecipient: "SELLER" } })).availableCents).toBe(BigInt(11500));
  expect(single(order(), shipment({ terms: { commissionBps: 10000, shippingRecipient: "PLATFORM" } })).availableCents).toBe(BigInt(0));
});
it("never invents a rate and requires real pricing before making money available", () => {
  expect(single(order(), shipment({ terms: null }))).toMatchObject({ availableCents: BigInt(0), holds: ["POLICY_REQUIRED"] });
  expect(single(order({ goodsCents: null, shippingCents: null }), shipment({ netCents: null, retainedCents: null }))).toMatchObject({ availableCents: BigInt(0), holds: ["PRICING_REQUIRED"] });
  for (const commissionBps of [-1, 10001, 1.5, NaN, Infinity]) expect(() => validateSettlementTerms({ ...terms, commissionBps })).toThrow();
});
it("makes an individual COD shipment available after delivery and collection without waiting for another seller", () => {
  const result = calculateSellerSettlement(order({ status: "SHIPPED", goodsCents: BigInt(20000) }), [shipment(), shipment({ id: "shipment-b", sellerId: "seller-b", status: "SHIPPED", codCollected: false })]);
  expect(result.shipments[0].availableCents).toBe(BigInt(9750)); expect(result.shipments[1]).toMatchObject({ availableCents: BigInt(0), holds: ["DELIVERY_REQUIRED", "COLLECTION_REQUIRED"] });
  expect(single(order({ paymentMethod: "STRIPE", paymentStatus: "PAID" }), shipment({ codCollected: false })).availableCents).toBe(BigInt(10500));
});
it.each([ ["refund", { refundState: "PENDING" }, "REFUND_PENDING"], ["review", { financialReviewReason: "ACTUAL_RECONCILIATION" }, "FINANCIAL_REVIEW"], ["reservation", { reservationReviewReason: "RECONCILE" }, "FINANCIAL_REVIEW"], ["dispute", { disputeStatus: "ACTIVE" as const }, "DISPUTE_ACTIVE"] ])("withdraws availability during an active %s while preserving the explained potential", (_name, changes, hold) => {
  expect(single(order(changes as Partial<SettlementOrderInput>))).toMatchObject({ potentialCents: BigInt(10500), availableCents: BigInt(0), holds: [hold] });
});
it("reverses only the remaining net goods' commission after refunds and reduces refunded shipping", () => {
  expect(single(order({ refundState: "PARTIAL", shippingRefundedCents: BigInt(500) }), shipment({ retainedCents: BigInt(6000) }))).toMatchObject({ commissionCents: BigInt(600), goodsCents: BigInt(6000), shippingCents: BigInt(1000), availableCents: BigInt(6400) });
});
it("allocates real lost provider funds before commission, conserves every paisa and exposes excess losses", () => {
  const result = single(order({ disputeStatus: "LOST", disputeAmountCents: BigInt(2300) })); expect(result).toMatchObject({ goodsCents: BigInt(8000), shippingCents: BigInt(1200), commissionCents: BigInt(800), availableCents: BigInt(8400), disputeLossCents: BigInt(2300) });
  const over = calculateSellerSettlement(order({ disputeStatus: "LOST", disputeAmountCents: BigInt(12000) }), [shipment()]); expect(over.unallocatedDisputeLossCents).toBe(BigInt(500)); expect(over.shipments[0].availableCents).toBe(BigInt(0));
});
it("uses exact money beyond float precision and stable ID ties regardless of input ordering", () => {
  const amount = BigInt("900719925474099312345"), weights = [{ id: "b", weight: BigInt(1) }, { id: "a", weight: BigInt(1) }, { id: "c", weight: BigInt(1) }];
  const first = allocateSettlementCents(amount, weights), second = allocateSettlementCents(amount, [...weights].reverse()); expect(first.reduce((sum, row) => sum + row.cents, BigInt(0))).toBe(amount); expect(new Map(first.map((row) => [row.id, row.cents]))).toEqual(new Map(second.map((row) => [row.id, row.cents])));
  expect(commissionCents(BigInt(5), 1000)).toBe(BigInt(1)); expect(commissionCents(BigInt(4), 1000)).toBe(BigInt(0));
});
it("uses gross weights when every good was fully discounted and never allocates more than an original shipping share", () => {
  const rows = [shipment({ grossCents: BigInt(1), netCents: BigInt(0), retainedCents: BigInt(0) }), shipment({ id: "shipment-b", sellerId: "seller-b", grossCents: BigInt(2), netCents: BigInt(0), retainedCents: BigInt(0) })];
  const result = calculateSellerSettlement(order({ goodsCents: BigInt(0), shippingCents: BigInt(5), shippingRefundedCents: BigInt(2) }), rows); expect(result.shipments.map((row) => row.originalShippingCents)).toEqual([BigInt(2), BigInt(3)]); expect(result.shipments.map((row) => row.shippingCents)).toEqual([BigInt(1), BigInt(2)]);
});
it("rejects malformed or inconsistent financial snapshots instead of calculating a plausible balance", () => {
  expect(() => single(order({ goodsCents: BigInt(9999) }))).toThrow(/reconcile/); expect(() => single(order({ shippingRefundedCents: BigInt(1501) }))).toThrow(/shipping/); expect(() => single(order(), shipment({ retainedCents: BigInt(10001) }))).toThrow(/Remaining/);
  expect(() => allocateSettlementCents(BigInt(1), [{ id: "a", weight: BigInt(0) }])).toThrow(); expect(() => allocateSettlementCents(BigInt(0), [{ id: "a", weight: BigInt(0) }, { id: "a", weight: BigInt(1) }])).toThrow();
});
it("conserves integer shipping/loss allocations across many uneven multi-vendor purchases", () => {
  for (let count = 1; count <= 12; count++) for (let seed = 1; seed <= 17; seed++) {
    const weights = Array.from({ length: count }, (_, index) => ({ id: `vendor-${index}`, weight: BigInt((seed * (index + 1) * 13) % 97) })), total = weights.reduce((sum, row) => sum + row.weight, BigInt(0));
    for (const amount of [BigInt(0), total / BigInt(3), total, total * BigInt(123456789)]) {
      const parts = allocateSettlementCents(amount, weights); expect(parts.reduce((sum, row) => sum + row.cents, BigInt(0))).toBe(amount);
      for (const [index, part] of parts.entries()) { expect(part.cents >= BigInt(0)).toBe(true); if (amount <= total) expect(part.cents <= weights[index].weight).toBe(true); }
    }
  }
});
