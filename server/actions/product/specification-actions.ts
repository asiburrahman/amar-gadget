"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUserWithRole } from "@/lib/session";
import { withCurrentAdmin, CatalogMutationError } from "@/lib/catalog-mutations";
import { catalogIdSchema } from "@/lib/validations/product";
import { specificationsSchema } from "@/lib/validations/specifications";

const inputSchema = z.object({ productId: catalogIdSchema, specifications: specificationsSchema }).strict();
export async function adminUpdateSpecifications(input: unknown) {
  const actor = await getCurrentUserWithRole(["ADMIN"]);
  if (!actor) return { success: false, error: "Unauthorized" };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid specifications." };
  try {
    const product = await withCurrentAdmin(actor, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${parsed.data.productId} FOR UPDATE`;
      const existing = await tx.product.findUnique({ where: { id: parsed.data.productId }, select: { id: true, slug: true } });
      if (!existing) throw new CatalogMutationError("Product not found.");
      await tx.product.update({ where: { id: existing.id }, data: { specifications: parsed.data.specifications } });
      return existing;
    });
    for (const path of ["/admin/products", "/products", `/products/${product.slug}`, "/compare"]) revalidatePath(path);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof CatalogMutationError ? error.message : "Unable to save specifications. Try again." };
  }
}
