"use server";

import { createProduct } from "@/server/actions/product/product-actions";

export type ActionState = { success: boolean; message: string; errors?: Record<string, string[] | undefined> };

/** Compatibility entry point shares the exact same validated publication path. */
export async function createProductAction(rawData: unknown): Promise<ActionState> {
  const result = await createProduct(rawData);
  return result.success ? { success: true, message: "Product submitted successfully" }
    : { success: false, message: result.error ?? "Unable to submit the product.", ...("errors" in result ? { errors: result.errors } : {}) };
}
