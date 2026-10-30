"use server";
import { z } from "zod";
import { getCurrentUserWithRole } from "@/lib/session";
import { mutateFulfillment } from "@/lib/fulfillments";
import { fulfillmentMutationSchema } from "@/lib/validations/fulfillment";
import { FulfillmentError } from "@/lib/fulfillment-policy";
import { invalidateFulfillmentPages } from "@/lib/fulfillment-request";
const schema = z.object({ ownerId: z.string().min(1).max(64), mutation: fulfillmentMutationSchema }).strict();
export async function updateShipmentDetails(input: unknown) {
  const actor = await getCurrentUserWithRole(["ADMIN"]);
  if (!actor) return { success: false as const, error: "Unauthorized" };
  const parsed = schema.safeParse(input);
  if (!parsed.success || parsed.data.ownerId !== actor.id || parsed.data.mutation.action !== "tracking") return { success: false as const, error: "Use the shipment's current revision, carrier, tracking number and administrator account." };
  try {
    const result = await mutateFulfillment(actor, parsed.data.mutation);
    invalidateFulfillmentPages(result.shipment.orderId);
    return { success: true as const, carrier: result.shipment.carrier, trackingNumber: result.shipment.trackingNumber, shipment: result.shipment };
  } catch (error) { return { success: false as const, error: error instanceof FulfillmentError ? error.message : "Shipment details could not be confirmed. Reload before retrying." }; }
}
