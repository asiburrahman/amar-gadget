import { allocateDiscount, refundPlan, proportional } from "@/lib/refund-policy";
const lines = [{ id: "a", quantity: 3, refundedQuantity: 0, netCents: 20000, refundedCents: 0, dispatched: false, paid: true }, { id: "b", quantity: 1, refundedQuantity: 0, netCents: 10000, refundedCents: 0, dispatched: false, paid: true }];
it("conserves discounts to the last paisa and breaks equal remainders by immutable identity", () => {
  expect(allocateDiscount([{ id: "b", grossCents: 100 }, { id: "a", grossCents: 100 }, { id: "c", grossCents: 100 }], 2)).toEqual([{ id: "b", netCents: 99 }, { id: "a", netCents: 99 }, { id: "c", netCents: 100 }]);
  for (let amount = 0; amount <= 300; amount++) expect(allocateDiscount([{ id: "a", grossCents: 99 }, { id: "b", grossCents: 201 }], amount).reduce((sum, row) => sum + row.netCents, 0)).toBe(300 - amount);
  expect(() => allocateDiscount([{ id: "a", grossCents: 10 }], 11)).toThrow(); expect(() => proportional(100, 2, 1)).toThrow();
});
it("returns all remaining goods and shipping before dispatch and no shipping after dispatch", () => {
  expect(refundPlan(lines, "FULL", 15000)).toMatchObject({ amountCents: 45000, shippingCents: 15000 });
  expect(refundPlan(lines.map((x) => ({ ...x, dispatched: true })), "FULL", 15000)).toMatchObject({ amountCents: 30000, shippingCents: 0 });
});
it("uses only an undispatched selection's proportional shipping share in a mixed order", () => {
  expect(refundPlan([{ ...lines[0], dispatched: true }, lines[1]], "FULL", 15000)).toMatchObject({ amountCents: 35000, shippingCents: 5000 });
  expect(refundPlan(lines, [{ itemId: "a", quantity: 1 }], 15000)).toMatchObject({ amountCents: 9999, shippingCents: 3333, lines: [{ amountCents: 6666, quantity: 1 }] });
});
it("keeps the final unit's rounding remainder and handles earlier amount-only adjustments", () => {
  expect(refundPlan([{ ...lines[0], refundedQuantity: 2, refundedCents: 13332 }], "FULL", 1)).toMatchObject({ amountCents: 6669, shippingCents: 1 });
  expect(refundPlan([{ ...lines[1], refundedCents: 2500 }], [{ itemId: "b", quantity: 1 }], 0)).toMatchObject({ amountCents: 7500 });
  expect(refundPlan([{ ...lines[1], refundedQuantity: 1, refundedCents: 2500 }], "FULL", 0)).toMatchObject({ amountCents: 7500, lines: [{ quantity: 0 }] });
});
it("rejects duplicate, foreign, unpaid and already-refunded quantities", () => {
  for (const selection of [[], [{ itemId: "foreign", quantity: 1 }], [{ itemId: "a", quantity: 4 }], [{ itemId: "a", quantity: 1 }, { itemId: "a", quantity: 1 }]]) expect(() => refundPlan(lines, selection, 0)).toThrow();
  expect(() => refundPlan(lines.map((x) => ({ ...x, paid: false })), "FULL", 100)).toThrow();
  expect(() => refundPlan([{ ...lines[0], refundedQuantity: 3 }], [{ itemId: "a", quantity: 1 }], 0)).toThrow();
});
