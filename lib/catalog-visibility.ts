import type { Prisma } from "@prisma/client";

/** Every public catalog surface must apply both product and seller approval. */
export const publicProductWhere = {
  status: "APPROVED",
  seller: { sellerStatus: "APPROVED" },
} satisfies Prisma.ProductWhereInput;
