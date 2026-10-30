import { aggregateFulfillmentState, fulfillmentCounts, fulfillmentStatusLabel } from "@/lib/fulfillment-policy";
import { fulfillmentMutationSchema, fulfillmentQuerySchema } from "@/lib/validations/fulfillment";
const fulfillmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
it.each([
  [["PENDING"], "PENDING"], [["PENDING", "PENDING"], "PENDING"], [["PROCESSING", "PROCESSING"], "PROCESSING"],
  [["PENDING", "PROCESSING"], "PROCESSING"], [["SHIPPED", "PROCESSING"], "PARTIALLY_SHIPPED"],
  [["SHIPPED", "SHIPPED"], "SHIPPED"], [["DELIVERED", "SHIPPED"], "PARTIALLY_DELIVERED"],
  [["DELIVERED", "PROCESSING"], "PARTIALLY_DELIVERED"], [["DELIVERED", "DELIVERED"], "DELIVERED"],
  [["CANCELLED", "CANCELLED"], "CANCELLED"],
])("aggregates actual shipment states without advancing an unshipped sibling: %j", (states, expected) => {
  expect(aggregateFulfillmentState(states as string[])).toBe(expected); expect(aggregateFulfillmentState([...(states as string[])].reverse())).toBe(expected);
});
it("refuses absent, unsupported or partially cancelled assignments instead of inventing completion", () => {
  for (const states of [[], ["UNKNOWN"], ["CANCELLED", "PROCESSING"], ["CANCELLED", "DELIVERED"]]) expect(() => aggregateFulfillmentState(states)).toThrow();
  expect(fulfillmentCounts(["PROCESSING", "SHIPPED", "DELIVERED"])).toEqual({ total: 3, pending: 0, processing: 1, shipped: 1, delivered: 1, cancelled: 0 }); expect(fulfillmentStatusLabel("PARTIALLY_DELIVERED")).toBe("Partially delivered");
});
it("requires an actual observed shipment revision, bounded plain tracking fields and supported actions", () => {
  const valid = { fulfillmentId, version: 3, action: "ship", carrier: "  Courier  ", trackingNumber: "TRACK-123" };
  expect(fulfillmentMutationSchema.parse(valid)).toEqual({ ...valid, carrier: "Courier" });
  for (const changes of [{ version: 0 }, { version: 1.5 }, { fulfillmentId: "order-alias" }, { carrier: "" }, { carrier: "c".repeat(81) }, { trackingNumber: "t".repeat(121) }, { carrier: "Courier\nInjected" }, { action: "refund" }, { sellerId: fulfillmentId }, { orderId: fulfillmentId }]) expect(fulfillmentMutationSchema.safeParse({ ...valid, ...changes }).success).toBe(false);
  expect(fulfillmentQuerySchema.parse({})).toEqual({ page: 1, status: "ALL" }); expect(fulfillmentQuerySchema.safeParse({ page: 0 }).success).toBe(false); expect(fulfillmentQuerySchema.safeParse({ limit: 10000 }).success).toBe(false);
});
