jest.mock("@/lib/session", () => ({ getCurrentUserWithRole: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/prisma", () => ({ prisma: {
  orderItem: { findFirst: jest.fn(), count: jest.fn() },
  order: { updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
} }));

import { prisma } from "@/lib/prisma";
import { getCurrentUserWithRole } from "@/lib/session";
import { updateOrderStatusBySeller } from "@/server/actions/order/order-actions";

describe("seller shipment state race", () => {
  it("does not overwrite an order cancelled between read and shipment update", async () => {
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue({ id: "seller", role: "MEMBER", sellerStatus: "APPROVED" });
    (prisma.orderItem.findFirst as jest.Mock).mockResolvedValue({ order: { status: "PROCESSING", paymentStatus: "UNPAID", paymentMethod: "COD" } });
    (prisma.orderItem.count as jest.Mock).mockResolvedValue(1);
    (prisma.order.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

    expect(await updateOrderStatusBySeller("order", "SHIPPED")).toEqual({ success: false, error: "The order changed. Refresh and try again." });
    expect(prisma.order.updateMany).toHaveBeenCalledWith({ where: { id: "order", status: "PROCESSING", paymentStatus: "UNPAID" }, data: { status: "SHIPPED" } });
    expect(prisma.order.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
