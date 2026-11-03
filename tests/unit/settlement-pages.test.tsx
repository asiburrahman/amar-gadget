import { renderToStaticMarkup } from "react-dom/server";
import Earnings from "@/app/(dashboard)/member/earnings/page";
import Payouts from "@/app/(dashboard)/member/payouts/page";
import Analytics from "@/app/(dashboard)/member/analytics/page";
import Admin from "@/app/(dashboard)/admin/settlements/page";
import { getCurrentUserWithRole } from "@/lib/session";
jest.mock("@/lib/session", () => ({ getCurrentUserWithRole: jest.fn() }));
jest.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
jest.mock("@/components/settlements/settlement-console", () => ({ SettlementConsole: ({ ownerId, ownerRole, initialMode }: { ownerId: string; ownerRole: string; initialMode?: string }) => <div data-owner={ownerId} data-role={ownerRole} data-mode={initialMode ?? "overview"} /> }));
beforeEach(() => { jest.clearAllMocks(); (getCurrentUserWithRole as jest.Mock).mockResolvedValue({ id: "seller", role: "MEMBER", sellerStatus: "APPROVED" }); });
it("wires separate earnings, payout and analytics views to the authenticated seller", async () => {
  expect(renderToStaticMarkup(await Earnings())).toContain('data-mode="shipments"'); expect(renderToStaticMarkup(await Payouts())).toContain('data-mode="payouts"'); expect(renderToStaticMarkup(await Analytics())).toContain('data-mode="overview"');
});
it("blocks unapproved/unauthenticated access before loading private client views", async () => {
  (getCurrentUserWithRole as jest.Mock).mockResolvedValue(null); for (const page of [Earnings, Payouts, Analytics, Admin]) await expect(page()).rejects.toThrow("redirect:/login"); (getCurrentUserWithRole as jest.Mock).mockResolvedValue({ id: "seller", role: "MEMBER", sellerStatus: "BLOCKED" }); for (const page of [Earnings, Payouts, Analytics]) expect(renderToStaticMarkup(await page())).not.toContain("data-owner");
});
it("uses the administrator's dedicated financial view rather than impersonating a seller", async () => {
  (getCurrentUserWithRole as jest.Mock).mockResolvedValue({ id: "admin", role: "ADMIN" }); for (const page of [Earnings, Payouts, Analytics]) await expect(page()).rejects.toThrow("redirect:/admin/settlements"); expect(renderToStaticMarkup(await Admin())).toContain('data-role="ADMIN"');
});
