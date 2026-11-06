/** @jest-environment jsdom */
import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FulfillmentConsole } from "@/components/orders/fulfillment-console";
import { useAuthStore } from "@/stores/auth-store";
import type { SellerFulfillment } from "@/lib/validations/fulfillment";
const mockRefresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
const owner = { id: "seller", name: "Seller", email: "seller@example.invalid", role: "MEMBER", sellerStatus: "APPROVED", isVerified: true, avatar: null };
const row: SellerFulfillment = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", orderId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", orderTrackingCode: "AG-TEST", version: 1, status: "PROCESSING", orderStatus: "PROCESSING", paymentMethod: "COD", paymentStatus: "UNPAID", codCollectedAt: null, recipientAddress: "Recipient street", recipientPhone: "01700000000", carrier: null, trackingNumber: null, shippedAt: null, deliveredAt: null, legacySnapshot: false, createdAt: "2026-10-30T00:00:00.000Z", items: [{ id: "own-item", productId: "own-product", name: "My gadget", imageUrl: null, unitPrice: 123, quantity: 2 }] };
const response = (data: unknown, status = 200) => ({ ok: status < 300, status, json: async () => data }) as Response;
const page = (shipment = row) => ({ success: true, ownerId: useAuthStore.getState().user!.id, shipments: [shipment], page: 1, total: 1, totalPages: 1 });
beforeEach(() => {
  jest.clearAllMocks(); useAuthStore.setState({ user: owner, loading: false, fetchUser: jest.fn().mockResolvedValue(owner) });
  global.fetch = jest.fn().mockResolvedValue(response(page()));
});
it("loads once in StrictMode and submits the owned package revision and actual tracking fields", async () => {
  let saved = false;
  (fetch as jest.Mock).mockImplementation(async (_url, init: RequestInit) => {
    if (init.method === "POST") { saved = true; expect(init.headers).toMatchObject({ "X-Fulfillment-Owner": owner.id }); expect(JSON.parse(String(init.body))).toEqual({ fulfillmentId: row.id, version: 1, action: "ship", carrier: "Actual courier", trackingNumber: "REAL-123" }); return response({ success: true, ownerId: owner.id, shipment: { ...row, status: "SHIPPED", version: 2 } }); }
    return response(page(saved ? { ...row, status: "SHIPPED", version: 2 } : row));
  });
  render(<StrictMode><FulfillmentConsole role="MEMBER" /></StrictMode>);
  fireEvent.change(await screen.findByLabelText("Carrier"), { target: { value: "Actual courier" } });
  expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText("Package tracking number"), { target: { value: "REAL-123" } });
  fireEvent.click(screen.getByRole("button", { name: "Mark my shipment as shipped" }));
  await screen.findByText("Your shipment was marked as shipped."); expect(mockRefresh).toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Confirm shipment delivered" })).toBeNull();
});
it("retains an uncertain save's draft, requires reload and explicit rebase before retrying a newer revision", async () => {
  let reloaded = false;
  (fetch as jest.Mock).mockImplementation(async (_url, init: RequestInit) => init.method === "POST" ? response({ success: false, message: "The shipment changed" }, 409) : response(page(reloaded ? { ...row, version: 2, carrier: "Saved courier", trackingNumber: "SAVED" } : row)));
  render(<FulfillmentConsole role="MEMBER" />);
  fireEvent.change(await screen.findByLabelText("Carrier"), { target: { value: "Keep courier" } }); fireEvent.change(screen.getByLabelText("Package tracking number"), { target: { value: "KEEP" } });
  fireEvent.click(screen.getByRole("button", { name: "Save tracking details" })); await screen.findByText("The shipment changed");
  expect(screen.getByRole("button", { name: "Save tracking details" })).toHaveProperty("disabled", true);
  expect(screen.getByLabelText("Carrier")).toHaveProperty("value", "Keep courier");
  reloaded = true; fireEvent.click(screen.getByRole("button", { name: "Reload saved shipments" }));
  fireEvent.click(await screen.findByRole("button", { name: "Keep my changes against the reloaded shipment" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Save tracking details" })).toHaveProperty("disabled", false));
  expect(screen.getByLabelText("Carrier")).toHaveProperty("value", "Keep courier");
});
it("requires the administrator's COD checkbox for the observed package revision", async () => {
  useAuthStore.setState({ user: { ...owner, id: "admin", role: "ADMIN" } });
  const shipped = { ...row, status: "SHIPPED" as const, carrier: "Courier", trackingNumber: "TRACK", version: 2 };
  (fetch as jest.Mock).mockImplementation(async (_url, init: RequestInit) => init.method === "POST" ? response({ success: true, ownerId: "admin", shipment: { ...shipped, version: 3, status: "DELIVERED", paymentStatus: "PAID" } }) : response(page(shipped)));
  render(<FulfillmentConsole role="ADMIN" />);
  const button = await screen.findByRole("button", { name: "Confirm shipment delivered" }); expect(button).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("checkbox", { name: /COD money/ })); fireEvent.click(button);
  await screen.findByText("Shipment delivery confirmed.");
  const [, init] = (fetch as jest.Mock).mock.calls.find(([, request]) => request.method === "POST");
  expect(JSON.parse(init.body)).toEqual({ fulfillmentId: row.id, version: 2, action: "deliver", codMoneyReceived: true });
});
it("aborts the old account's mutation and never applies its late response after a seller switch", async () => {
  let finish!: (value: Response) => void;
  (fetch as jest.Mock).mockImplementation((_url, init: RequestInit) => init.method === "POST" ? new Promise<Response>((resolve) => { finish = resolve; }) : Promise.resolve(response(page())));
  render(<FulfillmentConsole role="MEMBER" />);
  fireEvent.change(await screen.findByLabelText("Carrier"), { target: { value: "Courier" } }); fireEvent.change(screen.getByLabelText("Package tracking number"), { target: { value: "TRACK" } }); fireEvent.click(screen.getByRole("button", { name: "Mark my shipment as shipped" }));
  const init = (fetch as jest.Mock).mock.calls.find(([, value]) => value.method === "POST")[1];
  act(() => useAuthStore.setState({ user: null })); expect(init.signal.aborted).toBe(true);
  await act(async () => finish(response({ success: true, ownerId: owner.id, shipment: { ...row, status: "SHIPPED", version: 2 } })));
  expect(screen.queryByText("Your shipment was marked as shipped.")).toBeNull(); expect(mockRefresh).not.toHaveBeenCalled();
});
