"use server";

import { prisma } from "@/lib/prisma";
import { z } from "zod";

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
  userId: string,
  userRole: string,
  rawData: unknown
): Promise<ActionState> {
  if (userRole !== "MEMBER" && userRole !== "ADMIN") {
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

    await prisma.product.create({
      data: {
        ...validated.data,
        sellerId: userId,
        status: userRole === "ADMIN" ? "PUBLISHED" : "PENDING_APPROVAL",
      },
    });

    return { success: true, message: "Product submitted successfully" };
  } catch (error) {
    console.error("Database operation failed:", error);
    return { success: false, message: "Internal server error occurred" };
  }
}
