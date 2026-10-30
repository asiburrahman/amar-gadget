/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import OrderTracking from "../../components/orders/order-tracking";

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
  await waitFor(() => expect(screen.queryByRole("button", { name: "Load more history" })).toBeNull());
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
