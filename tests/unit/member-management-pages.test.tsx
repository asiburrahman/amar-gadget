import { renderToStaticMarkup } from "react-dom/server";
import Products from "@/app/(dashboard)/member/products/page";
import Orders from "@/app/(dashboard)/member/orders/page";
import Layout from "@/app/(dashboard)/member/layout";
import { getCurrentUserWithRole } from "@/lib/session";
jest.mock("@/lib/session", () => ({ getCurrentUserWithRole: jest.fn() }));
jest.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
jest.mock("@/components/catalog/product-maintenance-console", () => ({ ProductMaintenanceConsole: ({ ownerId, initialPage }: { ownerId: string; initialPage: number }) => <div data-catalog-owner={ownerId} data-page={initialPage} /> }));
jest.mock("@/components/orders/fulfillment-console", () => ({ FulfillmentConsole: ({ role }: { role: string }) => <div data-shipments-role={role} /> }));
beforeEach(() => { jest.clearAllMocks(); (getCurrentUserWithRole as jest.Mock).mockResolvedValue({ id: "seller", role: "MEMBER", sellerStatus: "APPROVED" }); });
it("wires standalone owner catalog and shipments with discoverable navigation", async () => {
  expect(renderToStaticMarkup(await Products({ searchParams: Promise.resolve({ page: "2" }) }))).toContain('data-page="2"'); expect(renderToStaticMarkup(await Orders())).toContain('data-shipments-role="MEMBER"'); const html = renderToStaticMarkup(await Layout({ children: "content" })); expect(html).toContain('href="/member/products"'); expect(html).toContain('href="/member/orders"');
});
it("refuses unauthenticated pages and redirects administrators to their shipment console", async () => {
  (getCurrentUserWithRole as jest.Mock).mockResolvedValue(null); await expect(Products({})).rejects.toThrow("redirect:/login"); await expect(Orders()).rejects.toThrow("redirect:/login"); (getCurrentUserWithRole as jest.Mock).mockResolvedValue({ id: "admin", role: "ADMIN" }); await expect(Orders()).rejects.toThrow("redirect:/admin/orders");
});
it("keeps unapproved sellers out of both consoles and rejects ambiguous page parameters", async () => {
  (getCurrentUserWithRole as jest.Mock).mockResolvedValue({ id: "seller", role: "MEMBER", sellerStatus: "BLOCKED" }); expect(renderToStaticMarkup(await Products({}))).not.toContain("data-catalog-owner"); expect(renderToStaticMarkup(await Orders())).not.toContain("data-shipments-role"); (getCurrentUserWithRole as jest.Mock).mockResolvedValue({ id: "seller", role: "MEMBER", sellerStatus: "APPROVED" }); expect(renderToStaticMarkup(await Products({ searchParams: Promise.resolve({ page: ["1", "2"] }) }))).toContain("Invalid page");
});
