jest.mock("../../lib/prisma", () => ({
  prisma: {
    category: {
      findUnique: jest.fn(),
    },
    product: {
      create: jest.fn(),
    },
  },
}));

jest.mock("../../lib/session", () => ({
  getCurrentUserWithRole: jest.fn(),
}));

import { createProductAction } from "../../app/(marketing)/products/_actions/create-product";
import { prisma } from "../../lib/prisma";
import { getCurrentUserWithRole } from "../../lib/session";

describe("createProductAction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue({
      id: "user-1",
      role: "MEMBER",
      sellerStatus: "APPROVED",
    });
  });

  it("should block non-members and non-admins from creating products", async () => {
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(null);
    const response = await createProductAction({
      name: "New iPhone",
      price: 120000,
      stock: 10,
      categoryId: "00000000-0000-0000-0000-000000000000",
    });

    expect(response.success).toBe(false);
    expect(response.message).toBe("Unauthorized action");
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it("should block product creation if category does not exist", async () => {
    (prisma.category.findUnique as jest.Mock).mockResolvedValue(null);

    const response = await createProductAction({
      name: "New iPhone",
      price: 120000,
      stock: 10,
      categoryId: "00000000-0000-0000-0000-000000000000",
    });

    expect(response.success).toBe(false);
    expect(response.message).toBe("Validation failed");
    expect(response.errors?.categoryId).toContain("Selected category does not exist");
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it("should allow members to submit products under pending status when category exists", async () => {
    (prisma.category.findUnique as jest.Mock).mockResolvedValue({ id: "cat-1" });
    (prisma.product.create as jest.Mock).mockResolvedValue({});

    const response = await createProductAction({
      name: "New iPhone",
      price: 120000,
      stock: 10,
      categoryId: "00000000-0000-0000-0000-000000000000",
    });

    expect(response.success).toBe(true);
    expect(response.message).toBe("Product submitted successfully");
    expect(prisma.product.create).toHaveBeenCalledWith({
      data: {
        name: "New iPhone",
        slug: expect.any(String),
        price: 120000,
        stock: 10,
        categoryId: "00000000-0000-0000-0000-000000000000",
        sellerId: "user-1",
        status: "PENDING_APPROVAL",
      },
    });
  });
});
