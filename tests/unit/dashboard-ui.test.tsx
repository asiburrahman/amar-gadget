/** @jest-environment jsdom */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import CustomerDashboardClient from "@/app/(dashboard)/user/dashboard/customer-dashboard-client";
import SellerDashboardClient from "@/app/(dashboard)/member/dashboard/seller-dashboard-client";
import { useAuthStore } from "@/stores/auth-store";
import { formatCurrency } from "@/lib/formatter";
import type { CustomerDashboard, SellerDashboardMetrics } from "@/lib/dashboard-metrics";
jest.mock("@/components/orders/fulfillment-console", () => ({ FulfillmentConsole: () => <p>Owned shipment console</p> }));
const buyer = { id: "buyer", name: "Buyer", email: "buyer@example.invalid", role: "USER", isVerified: true, avatar: null };
const seller = { ...buyer, id: "seller", role: "MEMBER", sellerStatus: "APPROVED" };
const customer: CustomerDashboard = { ownerId: buyer.id, ownerRole: buyer.role, profile: { name: "Private Buyer", email: buyer.email }, metrics: { totalOrders: 19, activeOrders: 4, netPaidCents: 25000, deliveredPaidCents: 12000, reviewOrders: 2, partiallyCollectedCodOrders: 1 }, recent: [] };
const metrics: SellerDashboardMetrics = { ownerId: seller.id, year: 2025, currentYear: 2026, firstYear: 2024, totalOrders: 38, pendingOrders: 3, paidItemCents: 76500, deliveredItemCents: 34200, deliveredUnits: 7, excludedLines: 2, monthly: [{ month: "2025-03", monthLabel: "March 2025", ordersCount: 2, paidItemCents: 4500, deliveredItemCents: 2100, deliveredUnits: 1, excludedLines: 1 }] };
const sellerProps = { seller, products: [], metrics, initialMainTab: "ANALYTICS" as const };
beforeEach(() => { jest.clearAllMocks(); useAuthStore.setState({ user: buyer, loading: false, fetchUser: jest.fn().mockResolvedValue(buyer) }); });
it("renders authoritative all-time customer counts separately from the bounded recent list and explains financial qualifications", () => {
  render(<CustomerDashboardClient snapshot={customer} />);
  expect(screen.getByRole("link", { name: "All My Orders (19)" })).toBeTruthy();
  expect(within(screen.getByText("Net Paid Order Value").parentElement!).getByText(formatCurrency(250))).toBeTruthy();
  expect(within(screen.getByText("Delivered Order Payments").parentElement!).getByText(formatCurrency(120))).toBeTruthy();
  expect(screen.getByText(/Showing the latest 0 orders/)).toBeTruthy(); expect(screen.getByText(/1 COD orders have only some shipments/)).toBeTruthy(); expect(screen.getByText(/2 orders have a pending refund/)).toBeTruthy();
});
it("removes private customer figures after account or role changes", () => {
  render(<CustomerDashboardClient snapshot={customer} />); expect(screen.getByText(/Private Buyer/)).toBeTruthy();
  act(() => useAuthStore.setState({ user: { ...buyer, id: "different-account" } })); expect(screen.queryByText(/Private Buyer/)).toBeNull(); expect(screen.queryByText("Net Paid Order Value")).toBeNull();
  act(() => useAuthStore.setState({ user: { ...buyer, role: "ADMIN" } })); expect(screen.queryByText(/Private Buyer/)).toBeNull();
});
it("renders server-calculated seller order counts, exact net amounts and bounded year navigation", () => {
  useAuthStore.setState({ user: seller }); render(<SellerDashboardClient {...sellerProps} />);
  expect(screen.getByRole("button", { name: /Incoming Customer Orders \(38\)/ })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Previous year" }).getAttribute("href")).toBe("/member/dashboard?year=2024"); expect(screen.getByRole("link", { name: "Next year" }).getAttribute("href")).toBe("/member/dashboard?year=2026");
  expect(screen.getByText("2 orders")).toBeTruthy(); expect(screen.getByText(formatCurrency(45))).toBeTruthy(); expect(screen.getByText(/not cash received or seller payout/)).toBeTruthy(); expect(screen.getByText(/2 paid item lines need/)).toBeTruthy();
});
it("accepts updated server aggregates without retaining an obsolete client-computed total", () => {
  useAuthStore.setState({ user: seller }); const { rerender } = render(<SellerDashboardClient {...sellerProps} />);
  expect(screen.getByText(formatCurrency(342))).toBeTruthy(); rerender(<SellerDashboardClient {...sellerProps} metrics={{ ...metrics, deliveredItemCents: 20000, totalOrders: 39 }} />);
  expect(screen.queryByText(formatCurrency(342))).toBeNull(); expect(screen.getByText(formatCurrency(200))).toBeTruthy(); expect(screen.getByRole("button", { name: /Incoming Customer Orders \(39\)/ })).toBeTruthy();
});
it("hides prior seller metrics and catalog after suspension or account switching", () => {
  useAuthStore.setState({ user: seller }); render(<SellerDashboardClient {...sellerProps} />);
  fireEvent.click(screen.getByRole("button", { name: /Incoming Customer Orders/ })); expect(screen.getByText("Owned shipment console")).toBeTruthy();
  act(() => useAuthStore.setState({ user: { ...seller, sellerStatus: "BLOCKED" } })); expect(screen.queryByText("Owned shipment console")).toBeNull(); expect(screen.queryByText(formatCurrency(342))).toBeNull();
  act(() => useAuthStore.setState({ user: { ...seller, id: "another-seller" } })); expect(screen.queryByText("Reconciled Paid Item Value")).toBeNull();
});
