import { renderToStaticMarkup } from "react-dom/server";
import { getCurrentUserWithRole } from "@/lib/session";
import { readAdministratorOverview } from "@/lib/admin-reporting";
import Analytics from "@/app/(dashboard)/admin/analytics/page";
import Users from "@/app/(dashboard)/admin/users/page";
import Members from "@/app/(dashboard)/admin/members/page";
import Sellers from "@/app/(dashboard)/admin/sellers/page";
import Reports from "@/app/(dashboard)/admin/reports/page";
import Dashboard from "@/app/(dashboard)/admin/page";
import { getAdminStats } from "@/server/actions/admin/admin-actions";
jest.mock("@/lib/prisma", () => ({ prisma: { product: { findMany: jest.fn().mockResolvedValue([]) } } }));
jest.mock("@/server/actions/admin/admin-actions", () => ({ getAdminStats: jest.fn() }));
jest.mock("@/lib/session", () => ({ getCurrentUserWithRole: jest.fn() }));
jest.mock("@/lib/admin-reporting", () => ({ readAdministratorOverview: jest.fn() }));
jest.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
jest.mock("@/components/admin/account-console", () => ({ AccountConsole: ({ ownerId, scope }: { ownerId: string; scope: string }) => <div data-owner={ownerId} data-scope={scope}>Directory</div> }));
jest.mock("@/components/admin/report-console", () => ({ ReportConsole: ({ ownerId }: { ownerId: string }) => <div data-owner={ownerId}>Report controls</div> }));
beforeEach(() => { jest.clearAllMocks(); (getCurrentUserWithRole as jest.Mock).mockResolvedValue({ id: "admin", role: "ADMIN" }); });
it("renders queried all-time counts and money without invented growth or health values", async () => {
  (readAdministratorOverview as jest.Mock).mockResolvedValue({ ownerId: "admin", asOf: "2026-11-02T00:00:00Z", users: 23, customers: 19, sellers: 3, administrators: 1, unverified: 4, pendingSellers: 2, products: 101, pendingProducts: 9, orders: 51, paidRevenueCents: 100015 });
  const html = renderToStaticMarkup(await Analytics()); expect(html).toContain("BDT 1,000.15"); expect(html).toContain("Registered accounts"); expect(html).toContain("Seller members"); expect(html).toContain("101"); for (const old of ["8.45M", "12,450", "99.98%", "24.2%", "100% Uptime"]) expect(html).not.toContain(old);
});
it("renders an explicit unavailable state when analytics cannot be confirmed", async () => {
  (readAdministratorOverview as jest.Mock).mockRejectedValue(new Error("private database diagnostic")); const html = renderToStaticMarkup(await Analytics()); expect(html).toContain("temporarily unavailable"); expect(html).not.toContain("private database diagnostic"); expect(html).not.toContain("BDT 0.00");
});
it("distinguishes all accounts and seller members, retains seller URL redirection and passes the observed report owner", async () => {
  expect(renderToStaticMarkup(await Users())).toContain('data-scope="accounts"'); expect(renderToStaticMarkup(await Members())).toContain('data-scope="members"'); expect(renderToStaticMarkup(await Reports())).toContain('data-owner="admin"'); await expect(Sellers()).rejects.toThrow("redirect:/admin/members");
});
it("requires administrator authorization before every page or report lookup", async () => {
  (getCurrentUserWithRole as jest.Mock).mockResolvedValue(null); for (const page of [Analytics, Users, Members, Sellers, Reports]) await expect(page()).rejects.toThrow("redirect:/login"); expect(readAdministratorOverview).not.toHaveBeenCalled();
});
it("keeps the final paisa in the root overview at the supported aggregate boundary", async () => {
  (getAdminStats as jest.Mock).mockResolvedValue({ success: true, stats: { totalUsers: 1, totalProducts: 0, pendingProducts: 0, totalOrders: 1, totalRevenue: Number.MAX_SAFE_INTEGER / 100, totalRevenueCents: Number.MAX_SAFE_INTEGER } });
  const html = renderToStaticMarkup(await Dashboard()); expect(html.replaceAll(",", "")).toContain("BDT 90071992547409.91");
});
