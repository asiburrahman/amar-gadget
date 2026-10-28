jest.mock("@/lib/session", () => ({ getCurrentUserWithRole: jest.fn() }));
jest.mock("next/navigation", () => ({ redirect: jest.fn((url: string) => { throw new Error(`redirect:${url}`); }) }));
jest.mock("../../app/(dashboard)/member/dashboard/seller-dashboard-client", () => ({ __esModule: true, default: () => null }));
jest.mock("@/lib/prisma", () => ({ prisma: {
  user: { findUnique: jest.fn() }, product: { findMany: jest.fn() }, orderItem: { findMany: jest.fn() },
} }));

import { renderToStaticMarkup } from "react-dom/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserWithRole } from "@/lib/session";
import SellerDashboardPage from "../../app/(dashboard)/member/dashboard/page";

describe("seller dashboard customer-data boundary", () => {
  it.each(["PENDING", "BLOCKED", "REJECTED"])("shows only account status for %s sellers", async (sellerStatus) => {
    jest.clearAllMocks();
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue({ id: "seller", role: "MEMBER", sellerStatus });
    const html = renderToStaticMarkup(await SellerDashboardPage());
    expect(html).toContain("Seller account status");
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.product.findMany).not.toHaveBeenCalled();
    expect(prisma.orderItem.findMany).not.toHaveBeenCalled();
  });
});
