/** @jest-environment jsdom */
import { act, render, screen } from "@testing-library/react";
import UserOrdersClient from "@/app/(dashboard)/user/orders/user-orders-client";
import { useAuthStore } from "@/stores/auth-store";
jest.mock("@/components/orders/customer-shipments", () => ({ CustomerShipments: () => <p>Shipment details retained</p> }));
jest.mock("@/components/orders/refund-console", () => ({ RefundDetails: () => <p>Refund details retained</p> }));
const buyer = { id: "buyer", name: "Buyer", email: "buyer@example.invalid", role: "USER", isVerified: true, avatar: null };
const props = { user: buyer, initialOrders: [{ id: "historical-order", total: 100, status: "PENDING", paymentMethod: "COD", paymentStatus: "UNPAID", shippingAddress: null, trackingNumber: null, createdAt: "2026-11-03T00:00:00Z", items: [{ id: "item", quantity: 1, price: 100, product: { id: "product", name: "Original purchased gadget", slug: "original-gadget", imageUrl: null } }] }], query: { q: "Original", status: "ACTIVE" as const }, counts: { ALL: 47, ACTIVE: 32, DELIVERED: 12, CANCELLED: 3 } };
beforeEach(() => { useAuthStore.setState({ user: buyer, loading: false, fetchUser: jest.fn().mockResolvedValue(buyer) }); });
it("renders server counts and GET filters while retaining original item, shipment and refund details", () => {
  render(<UserOrdersClient {...props} />);
  expect(screen.getByRole("option", { name: "All orders (47)" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "Active (32)" })).toBeTruthy();
  const select = screen.getByRole("combobox") as HTMLSelectElement; expect(select.value).toBe("ACTIVE");
  const input = screen.getByRole("searchbox") as HTMLInputElement; expect(input.value).toBe("Original");
  expect(input.closest("form")?.getAttribute("method")).toBe("GET"); expect(input.closest("form")?.getAttribute("action")).toBe("/user/orders");
  expect(screen.getByRole("link", { name: "Original purchased gadget" }).getAttribute("href")).toBe("/products/original-gadget");
  expect(screen.getByText("Shipment details retained")).toBeTruthy(); expect(screen.getByText("Refund details retained")).toBeTruthy();
});
it("hides the prior owner's entire order history when the active account changes", () => {
  render(<UserOrdersClient {...props} />);
  act(() => useAuthStore.setState({ user: { ...buyer, id: "another-buyer" } }));
  expect(screen.queryByText("Original purchased gadget")).toBeNull(); expect(screen.queryByRole("searchbox")).toBeNull();
});
it("shows a genuine empty search without inventing orders or overwriting whole-history counts", () => {
  render(<UserOrdersClient {...props} initialOrders={[]} />);
  expect(screen.getByText("No orders found")).toBeTruthy(); expect(screen.getByRole("option", { name: "All orders (47)" })).toBeTruthy();
  expect(screen.getByText(/No orders matching/)).toBeTruthy();
});
