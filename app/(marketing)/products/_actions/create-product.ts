"use server";

import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { getCurrentUserWithRole } from "@/lib/session";

const createProductSchema = z.object({
  name: z.string().min(3, "Name must be at least 3 characters"),
  price: z.number().positive("Price must be greater than zero"),
  stock: z.number().int().nonnegative(),
  categoryId: z.string().uuid("Invalid category ID"),
});

export type ActionState = {
  success: boolean;
  message: string;
  errors?: Record<string, string[]>;
};

export async function createProductAction(
  rawData: unknown
): Promise<ActionState> {
  const user = await getCurrentUserWithRole(["MEMBER", "ADMIN"]);
  if (!user || (user.role.toUpperCase() === "MEMBER" && user.sellerStatus !== "APPROVED")) {
    return { success: false, message: "Unauthorized action" };
  }

  const validated = createProductSchema.safeParse(rawData);
  if (!validated.success) {
    return {
      success: false,
      message: "Validation failed",
      errors: validated.error.flatten().fieldErrors,
    };
  }

  try {
    // Production sanity check: Verify Category exists to avoid constraint crashes
    const categoryExists = await prisma.category.findUnique({
      where: { id: validated.data.categoryId },
    });

    if (!categoryExists) {
      return {
        success: false,
        message: "Validation failed",
        errors: { categoryId: ["Selected category does not exist"] },
      };
    }

    const slug = validated.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Date.now();

    await prisma.product.create({
      data: {
        ...validated.data,
        slug,
        sellerId: user.id,
        status: user.role.toUpperCase() === "ADMIN" ? "APPROVED" : "PENDING_APPROVAL",
      },
    });

    return { success: true, message: "Product submitted successfully" };
  } catch (error) {
    console.error("Database operation failed:", error);
    return { success: false, message: "Internal server error occurred" };
  }
}
