/** @jest-environment jsdom */
import { act, render, screen } from "@testing-library/react";
import AdminOrdersClient from "@/app/(dashboard)/admin/orders/admin-orders-client";
import { useAuthStore } from "@/stores/auth-store";
import { formatCurrency } from "@/lib/formatter";
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock("@/server/actions/order/order-actions", () => ({ updateOrderStatusByAdmin: jest.fn() }));
jest.mock("@/components/orders/shipment-editor", () => ({ ShipmentEditor: ({ orderId }: { orderId: string }) => <p>Shipment editor for {orderId}</p> }));
jest.mock("@/components/orders/refund-console", () => ({ RefundConsole: () => <p>Financial management retained</p> }));
const admin = { id: "admin", name: "Admin", email: "admin@example.invalid", role: "ADMIN", isVerified: true, avatar: null };
const props = { ownerId: admin.id, initialOrders: [{ id: "order-123", fulfillmentVersion: 7, total: 100, refundedAmount: 0, disputeLossAmount: 0, status: "PENDING", paymentMethod: "COD", paymentStatus: "UNPAID", shippingAddress: "Actual saved address", trackingNumber: "original-tracking", shippingCarrier: null, shipmentTrackingNumber: null, createdAt: "2026-11-03T00:00:00Z", user: { id: "buyer", name: "Private buyer", email: "buyer@example.invalid", phone: null }, items: [{ id: "item", quantity: 1, price: 100, product: { id: "product", name: "Original purchase label", price: 100, imageUrl: null } }] }], pageData: { page: 2, totalPages: 3, total: 43, q: "Private", status: "ALL" as const, counts: { ALL: 43, PENDING: 32, DELIVERED: 11 }, summary: { orders: 73, pending: 44, delivered: 29, netFullyCollectedCents: 1234500, partiallyCollectedCodOrders: 2 } } };
beforeEach(() => { useAuthStore.setState({ user: admin, loading: false, fetchUser: jest.fn().mockResolvedValue(admin) }); });
it("renders authoritative whole-market cards, filtered server counts and query-preserving page links", () => {
  render(<AdminOrdersClient {...props} />);
  expect(screen.getByText("73")).toBeTruthy(); expect(screen.getByText(formatCurrency(12345))).toBeTruthy();
  expect(screen.getByText(/43 matching orders, 1 shown/)).toBeTruthy();
  expect(screen.getByRole("option", { name: "PENDING (32)" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Next orders" }).getAttribute("href")).toBe("/admin/orders?q=Private&status=ALL&page=3");
  expect(screen.getByRole("searchbox").closest("form")?.getAttribute("method")).toBe("GET");
  expect(screen.getByText(/2 partially collected COD orders/)).toBeTruthy();
  expect(screen.getByText("Original purchase label")).toBeTruthy(); expect(screen.getByText("Shipment editor for order-123")).toBeTruthy();
});
it("removes all previous customer/order data when the administrator session changes", () => {
  render(<AdminOrdersClient {...props} />);
  act(() => useAuthStore.setState({ user: { ...admin, role: "USER" } }));
  expect(screen.queryByText("Private buyer")).toBeNull(); expect(screen.queryByText("Original purchase label")).toBeNull(); expect(screen.queryByRole("searchbox")).toBeNull();
});
it("shows an empty matching filter while retaining the complete marketplace summary", () => {
  render(<AdminOrdersClient {...props} initialOrders={[]} pageData={{ ...props.pageData, total: 0, page: 1, totalPages: 1 }} />);
  expect(screen.getByText("No orders matching this criteria.")).toBeTruthy(); expect(screen.getByText("73")).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Next orders" })).toBeNull();
});
