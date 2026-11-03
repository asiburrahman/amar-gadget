import { renderToStaticMarkup } from "react-dom/server";
import Customer from "@/app/(dashboard)/user/notifications/page";
import Seller from "@/app/(dashboard)/member/notifications/page";
import Admin from "@/app/(dashboard)/admin/notifications/page";
import Queue from "@/app/(dashboard)/admin/notifications/delivery/page";
import { getCurrentUserWithRole } from "@/lib/session";
jest.mock("@/lib/session", () => ({ getCurrentUserWithRole: jest.fn() }));
jest.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
jest.mock("@/components/notifications/notification-inbox", () => ({ NotificationInboxConsole: ({ ownerId, ownerRole }: { ownerId: string; ownerRole: string }) => <div data-owner={ownerId} data-role={ownerRole} /> }));
jest.mock("@/components/notifications/notification-queue", () => ({ NotificationQueueConsole: ({ ownerId }: { ownerId: string }) => <div data-delivery-owner={ownerId} /> }));
beforeEach(() => { jest.clearAllMocks(); });
it("loads actual canonical inboxes for all three roles and keeps blocked sellers' decisions readable", async () => {
  for (const [role, page] of [["USER", Customer], ["MEMBER", Seller], ["ADMIN", Admin]] as const) { (getCurrentUserWithRole as jest.Mock).mockResolvedValue({ id: "owner", role, sellerStatus: "BLOCKED" }); expect(renderToStaticMarkup(await page())).toContain(`data-role="${role}"`); }
  (getCurrentUserWithRole as jest.Mock).mockResolvedValue({ id: "admin", role: "ADMIN" }); expect(renderToStaticMarkup(await Queue())).toContain('data-delivery-owner="admin"');
});
it("requires a current session before any private page", async () => {
  (getCurrentUserWithRole as jest.Mock).mockResolvedValue(null); for (const page of [Customer, Seller, Admin, Queue]) await expect(page()).rejects.toThrow("redirect:/login");
});
it("redirects alternate account routes to the actual role inbox", async () => {
  (getCurrentUserWithRole as jest.Mock).mockResolvedValue({ id: "seller", role: "MEMBER" }); await expect(Customer()).rejects.toThrow("redirect:/member/notifications"); (getCurrentUserWithRole as jest.Mock).mockResolvedValue({ id: "admin", role: "ADMIN" }); await expect(Seller()).rejects.toThrow("redirect:/admin/notifications");
});
