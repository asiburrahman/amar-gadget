"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getCurrentUserWithRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const shipmentSchema = z.object({
  orderId: z.string().uuid(),
  carrier: z.string().trim().min(2).max(80),
  trackingNumber: z.string().trim().min(2).max(120),
}).strict();

export async function updateShipmentDetails(input: unknown) {
  if (!(await getCurrentUserWithRole(["ADMIN"]))) return { success: false as const, error: "Unauthorized" };
  const parsed = shipmentSchema.safeParse(input);
  if (!parsed.success) return { success: false as const, error: "Enter a valid carrier and shipment tracking number." };
  try {
    const { orderId, carrier, trackingNumber } = parsed.data;
    // A conditional write handles concurrent cancellation or payment failure.
    // The database trigger appends the event in this same transaction.
    const result = await prisma.order.updateMany({
      where: { id: orderId, status: { in: ["PROCESSING", "SHIPPED"] }, OR: [{ paymentMethod: "COD" }, { paymentMethod: "STRIPE", paymentStatus: "PAID" }] },
      data: { shippingCarrier: carrier, shipmentTrackingNumber: trackingNumber },
    });
    if (result.count !== 1) return { success: false as const, error: "Shipment details can only be saved for a processing or shipped order with eligible payment. Refresh the order." };
    revalidatePath("/admin/orders");
    revalidatePath(`/order-success/${orderId}`);
    return { success: true as const, carrier, trackingNumber };
  } catch {
    return { success: false as const, error: "Shipment details could not be saved. Please retry." };
  }
}
