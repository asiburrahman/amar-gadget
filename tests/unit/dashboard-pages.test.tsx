jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn(), getCurrentUserWithRole: jest.fn() }));
jest.mock("next/navigation", () => ({ redirect: jest.fn((url: string) => { throw new Error(`redirect:${url}`); }) }));
jest.mock("@/lib/dashboard-metrics", () => ({ ...jest.requireActual("@/lib/dashboard-metrics"), readCustomerDashboard: jest.fn(), readSellerDashboardMetrics: jest.fn() }));
jest.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: jest.fn() }, product: { findMany: jest.fn() } } }));
import { getCurrentUser, getCurrentUserWithRole } from "@/lib/session";
import { DashboardAccessError, readCustomerDashboard, readSellerDashboardMetrics } from "@/lib/dashboard-metrics";
import { prisma } from "@/lib/prisma";
import CustomerPage from "@/app/(dashboard)/user/dashboard/page";
import SellerPage from "@/app/(dashboard)/member/dashboard/page";
import { ServiceUnavailableError } from "@/lib/observability";
const actor = { id: "own-account", role: "USER", sellerStatus: "APPROVED", sessionVersion: 1 };
beforeEach(() => { jest.clearAllMocks(); (getCurrentUser as jest.Mock).mockResolvedValue(actor); (getCurrentUserWithRole as jest.Mock).mockResolvedValue({ ...actor, role: "MEMBER" }); });
it("uses the current validated customer account and redirects revoked sessions", async () => {
  (readCustomerDashboard as jest.Mock).mockResolvedValue({ ownerId: actor.id }); await CustomerPage(); expect(readCustomerDashboard).toHaveBeenCalledWith(actor);
  (readCustomerDashboard as jest.Mock).mockRejectedValue(new DashboardAccessError("Revoked")); await expect(CustomerPage()).rejects.toThrow("redirect:/login");
});
it("propagates database failures instead of showing an invented zero-order dashboard", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    (readCustomerDashboard as jest.Mock).mockRejectedValue(new Error("Database unavailable"));
    (readSellerDashboardMetrics as jest.Mock).mockRejectedValue(new Error("Database unavailable"));
    for (const [page, operation] of [[CustomerPage, "customer.metrics"], [SellerPage, "seller.metrics"]] as const) {
      let caught: unknown; try { await page(); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(ServiceUnavailableError); expect((caught as ServiceUnavailableError).incident.operation).toBe(operation); expect(JSON.parse(log.mock.calls.at(-1)![0]).reference).toBe((caught as ServiceUnavailableError).digest);
    }
    expect(log).toHaveBeenCalledTimes(2); expect(JSON.stringify(log.mock.calls)).not.toContain("Database unavailable");
  } finally { log.mockRestore(); }
});
it("rejects duplicated/invalid year input before querying seller metrics or products", async () => {
  await SellerPage({ searchParams: Promise.resolve({ year: ["2026", "2025"] }) }); expect(readSellerDashboardMetrics).not.toHaveBeenCalled(); expect(prisma.product.findMany).not.toHaveBeenCalled();
});
it("redirects missing customer sessions before any private aggregation", async () => {
  (getCurrentUser as jest.Mock).mockResolvedValue(null); await expect(CustomerPage()).rejects.toThrow("redirect:/login"); expect(readCustomerDashboard).not.toHaveBeenCalled();
});
