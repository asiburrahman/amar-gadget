import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";

const collisionMetadata = z.object({
  modelName: z.literal("Order"),
  driverAdapterError: z.object({ cause: z.object({ constraint: z.object({ index: z.literal("Order_trackingNumber_key") }) }) }),
});

/** Repeat only the fully rolled-back creation transaction for this specific
 * PostgreSQL uniqueness conflict. Never repeat a provider call or a committed
 * order, and never reinterpret another unique constraint as a tracking clash. */
export async function withOrderTrackingRetry<T>(create: (trackingNumber: string) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await create(`AG-${randomBytes(16).toString("hex").toUpperCase()}`); }
    catch (error) {
      if (attempt === 2 || !(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002" || !collisionMetadata.safeParse(error.meta).success) throw error;
    }
  }
  throw Error("Order tracking allocation did not complete.");
}
