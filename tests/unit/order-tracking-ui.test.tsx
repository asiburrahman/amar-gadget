/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import OrderTracking from "../../components/orders/order-tracking";
import { ShipmentEditor } from "../../components/orders/shipment-editor";
import { updateShipmentDetails } from "../../server/actions/order/shipment-actions";

jest.mock("@/server/actions/order/shipment-actions", () => ({ updateShipmentDetails: jest.fn() }));
const response = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;
const order = {
  id: "order", status: "SHIPPED", carrier: "Actual carrier", shipmentTrackingNumber: "PARCEL-123", nextCursor: "next",
  timeline: [{ id: "old", step: "Status at history activation: Processing", date: null, done: true, current: false, carrier: null, shipmentTrackingNumber: null }],
};
beforeEach(() => { jest.clearAllMocks(); global.fetch = jest.fn(); });

it("shows unknown legacy times truthfully, current shipment data and paginated actual events", async () => {
  (fetch as jest.Mock).mockResolvedValueOnce(response({ success: true, order })).mockResolvedValueOnce(response({ success: true, order: {
    ...order, nextCursor: null, timeline: [{ id: "new", step: "Shipped", date: "2026-10-28T12:00:00.000Z", done: true, current: true, carrier: "Actual carrier", shipmentTrackingNumber: "PARCEL-123" }],
  } }));
  render(<OrderTracking initialOrderId="AG-123" />);
  expect(screen.getByLabelText("Order ID *")).toHaveProperty("value", "AG-123");
  fireEvent.change(screen.getByLabelText("Phone Number *"), { target: { value: "01700000000" } });
  fireEvent.click(screen.getByRole("button", { name: "Track Package" }));
  await screen.findByText("Exact transition time unavailable");
  expect(screen.getByText("Actual carrier — PARCEL-123")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Load more history" }));
  await screen.findByText("Shipped");
  expect(screen.getByText("Exact transition time unavailable")).toBeTruthy();
  expect((fetch as jest.Mock).mock.calls[1][0]).toContain("cursor=next");
  expect(screen.queryByRole("button", { name: "Load more history" })).toBeNull();
});

it("does not show a tracking result on lookup denial and preserves existing history on pagination failure", async () => {
  (fetch as jest.Mock).mockResolvedValueOnce(response({ success: false, message: "No order matched those details." }, false))
    .mockResolvedValueOnce(response({ success: true, order }))
    .mockRejectedValueOnce(new Error("Network unavailable"));
  render(<OrderTracking initialOrderId="AG-123" />);
  fireEvent.change(screen.getByLabelText("Phone Number *"), { target: { value: "01700000000" } });
  fireEvent.click(screen.getByRole("button", { name: "Track Package" }));
  await screen.findByText("No order matched those details.");
  expect(screen.queryByText("Recorded Order History")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Track Package" }));
  fireEvent.click(await screen.findByRole("button", { name: "Load more history" }));
  await screen.findByText("Network unavailable");
  expect(screen.getByText("Exact transition time unavailable")).toBeTruthy();
});

it("saves actual shipment fields and keeps the saved values when the order becomes read-only", async () => {
  (updateShipmentDetails as jest.Mock).mockResolvedValue({ success: true, carrier: "Carrier", trackingNumber: "REAL-123" });
  const view = render(<ShipmentEditor orderId="order" carrier={null} trackingNumber={null} editable />);
  fireEvent.change(screen.getByRole("textbox", { name: "Carrier for order" }), { target: { value: "Carrier" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Shipment tracking number for order" }), { target: { value: "REAL-123" } });
  fireEvent.click(screen.getByRole("button", { name: "Save shipment details" }));
  await screen.findByRole("status");
  expect(updateShipmentDetails).toHaveBeenCalledWith({ orderId: "order", carrier: "Carrier", trackingNumber: "REAL-123" });
  view.rerender(<ShipmentEditor orderId="order" carrier={null} trackingNumber={null} editable={false} />);
  expect(screen.getByText("Shipment: Carrier — REAL-123")).toBeTruthy();
});

it("shows shipment save errors without claiming success and permits retry", async () => {
  (updateShipmentDetails as jest.Mock).mockResolvedValue({ success: false, error: "The order changed. Refresh the order." });
  render(<ShipmentEditor orderId="order" carrier="Carrier" trackingNumber="REAL-123" editable />);
  fireEvent.click(screen.getByRole("button", { name: "Save shipment details" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "The order changed. Refresh the order.");
  expect(screen.queryByText("Shipment details saved.")).toBeNull();
  await waitFor(() => expect(screen.getByRole("button", { name: "Save shipment details" })).toHaveProperty("disabled", false));
});
