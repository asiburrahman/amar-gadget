jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn(), getCurrentUserWithRole: jest.fn() }));
jest.mock("next/navigation", () => ({ redirect: jest.fn((url: string) => { throw new Error(`redirect:${url}`); }) }));
jest.mock("@/lib/dashboard-metrics", () => ({ ...jest.requireActual("@/lib/dashboard-metrics"), readCustomerDashboard: jest.fn(), readSellerDashboardMetrics: jest.fn() }));
jest.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: jest.fn() }, product: { findMany: jest.fn() } } }));
import { getCurrentUser, getCurrentUserWithRole } from "@/lib/session";
import { DashboardAccessError, readCustomerDashboard, readSellerDashboardMetrics } from "@/lib/dashboard-metrics";
import { prisma } from "@/lib/prisma";
import CustomerPage from "@/app/(dashboard)/user/dashboard/page";
import SellerPage from "@/app/(dashboard)/member/dashboard/page";
const actor = { id: "own-account", role: "USER", sellerStatus: "APPROVED", sessionVersion: 1 };
beforeEach(() => { jest.clearAllMocks(); (getCurrentUser as jest.Mock).mockResolvedValue(actor); (getCurrentUserWithRole as jest.Mock).mockResolvedValue({ ...actor, role: "MEMBER" }); });
it("uses the current validated customer account and redirects revoked sessions", async () => {
  (readCustomerDashboard as jest.Mock).mockResolvedValue({ ownerId: actor.id }); await CustomerPage(); expect(readCustomerDashboard).toHaveBeenCalledWith(actor);
  (readCustomerDashboard as jest.Mock).mockRejectedValue(new DashboardAccessError("Revoked")); await expect(CustomerPage()).rejects.toThrow("redirect:/login");
});
it("propagates database failures instead of showing an invented zero-order dashboard", async () => {
  (readCustomerDashboard as jest.Mock).mockRejectedValue(new Error("Database unavailable")); await expect(CustomerPage()).rejects.toThrow("Database unavailable");
  (readSellerDashboardMetrics as jest.Mock).mockRejectedValue(new Error("Database unavailable")); await expect(SellerPage()).rejects.toThrow("Database unavailable");
});
it("rejects duplicated/invalid year input before querying seller metrics or products", async () => {
  await SellerPage({ searchParams: Promise.resolve({ year: ["2026", "2025"] }) }); expect(readSellerDashboardMetrics).not.toHaveBeenCalled(); expect(prisma.product.findMany).not.toHaveBeenCalled();
});
it("redirects missing customer sessions before any private aggregation", async () => {
  (getCurrentUser as jest.Mock).mockResolvedValue(null); await expect(CustomerPage()).rejects.toThrow("redirect:/login"); expect(readCustomerDashboard).not.toHaveBeenCalled();
});
