jest.mock("@/lib/session", () => ({ getCurrentUserWithRole: jest.fn() }));
jest.mock("@/lib/fulfillments", () => ({ mutateFulfillment: jest.fn(), mutateWholeOrder: jest.fn() }));
jest.mock("@/lib/fulfillment-request", () => ({ invalidateFulfillmentPages: jest.fn() }));
import { getCurrentUserWithRole } from "@/lib/session";
import { mutateFulfillment } from "@/lib/fulfillments";
import { FulfillmentError } from "@/lib/fulfillment-policy";
import { updateOrderStatusBySeller, updateOrderStatusByAdmin } from "@/server/actions/order/order-actions";
beforeEach(() => jest.clearAllMocks());
it("rejects old versionless whole-order shipment and delivery inputs before any mutation", async () => {
  (getCurrentUserWithRole as jest.Mock).mockResolvedValue({ id: "seller", role: "MEMBER", sellerStatus: "APPROVED" });
  expect(await updateOrderStatusBySeller("order", "SHIPPED")).toMatchObject({ success: false });
  expect(await updateOrderStatusBySeller("group", "SHIPPED", { ownerId: "other", version: 1, carrier: "Courier", trackingNumber: "TRACK" })).toMatchObject({ success: false });
  (getCurrentUserWithRole as jest.Mock).mockResolvedValue({ id: "admin", role: "ADMIN" });
  expect(await updateOrderStatusByAdmin("order", "DELIVERED", { ownerId: "admin", version: 1 })).toMatchObject({ success: false });
  expect(mutateFulfillment).not.toHaveBeenCalled();
});
it("preserves the canonical shipment conflict without an alternate order-level write", async () => {
  (getCurrentUserWithRole as jest.Mock).mockResolvedValue({ id: "seller", role: "MEMBER", sellerStatus: "APPROVED" });
  (mutateFulfillment as jest.Mock).mockRejectedValue(new FulfillmentError("Shipment changed; reload it.", "FULFILLMENT_CHANGED"));
  expect(await updateOrderStatusBySeller("group", "SHIPPED", { ownerId: "seller", version: 3, carrier: "Courier", trackingNumber: "TRACK" })).toEqual({ success: false, error: "Shipment changed; reload it." });
  expect(mutateFulfillment).toHaveBeenCalledWith(expect.objectContaining({ id: "seller" }), { fulfillmentId: "group", action: "ship", version: 3, carrier: "Courier", trackingNumber: "TRACK" });
});
