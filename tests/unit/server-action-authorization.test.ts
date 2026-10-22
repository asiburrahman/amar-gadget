jest.mock("@/lib/session", () => ({
  getCurrentUser: jest.fn(),
  getCurrentUserWithRole: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      count: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    product: {
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    order: {
      count: jest.fn(),
      aggregate: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

jest.mock("next/cache", () => ({
  revalidatePath: jest.fn(),
}));

import { prisma } from "@/lib/prisma";
import { getCurrentUser, getCurrentUserWithRole } from "@/lib/session";
import {
  getAdminStats,
  updateProductStatus,
} from "@/server/actions/admin/admin-actions";
import { getUserOrders } from "@/server/actions/order/order-actions";
import { createProduct } from "@/server/actions/product/product-actions";

describe("server action authorization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(null);
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
  });

  it("does not return admin statistics to anonymous users", async () => {
    const result = await getAdminStats();

    expect(result.success).toBe(false);
    expect(prisma.user.count).not.toHaveBeenCalled();
    expect(prisma.order.aggregate).not.toHaveBeenCalled();
  });

  it("does not allow anonymous users to mutate products", async () => {
    const result = await updateProductStatus("product-1", "APPROVED");

    expect(result).toEqual({ success: false, error: "Unauthorized" });
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it("does not allow product creation without a session role", async () => {
    const result = await createProduct({
      name: "New product",
      price: 100,
      stock: 2,
      images: [],
      categoryId: "category-1",
      isFeatured: false,
    });

    expect(result).toEqual({ success: false, error: "Unauthorized" });
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it("does not return another user's order list without an authenticated user", async () => {
    const result = await getUserOrders();

    expect(result).toEqual({ success: false, error: "Unauthorized", data: [] });
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });

  it("allows a verified admin role from the server session to update a product", async () => {
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue({
      id: "admin-1",
      email: "admin@example.test",
      role: "ADMIN",
      sellerStatus: "APPROVED",
    });
    (prisma.product.update as jest.Mock).mockResolvedValue({ id: "product-1" });

    const result = await updateProductStatus("product-1", "APPROVED");

    expect(result.success).toBe(true);
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: "product-1" },
      data: { status: "APPROVED" },
    });
  });
});
