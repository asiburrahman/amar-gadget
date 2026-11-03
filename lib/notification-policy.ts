import { z } from "zod";
export const NOTIFICATION_KINDS = ["SELLER_APPLICATION", "SELLER_STATUS", "ACCOUNT_ACCESS", "PRODUCT_REVIEW", "PRODUCT_STATUS", "ORDER_PLACED", "ORDER_STATUS", "PAYMENT_STATUS", "SHIPMENT_ASSIGNED", "SHIPMENT_STATUS", "REFUND_STATUS", "DISPUTE_STATUS", "PAYOUT_STATUS", "COMMERCIAL_POLICY"] as const;
export const NOTIFICATION_AUDIENCES = ["ACCOUNT", "SELLER", "ADMIN"] as const;
export function notificationInboxPath(role: string) {
  if (role === "ADMIN") return "/admin/notifications";
  if (role === "MEMBER") return "/member/notifications";
  return "/user/notifications";
}
export class NotificationError extends Error {
  constructor(message: string, readonly code: string, readonly status = 409) { super(message); }
}
export class NotificationDeliveryError extends Error {
  constructor(readonly code: "STALE_NOTIFICATION_LEASE" | "INVALID_NOTIFICATION_EVENT") { super("Notification delivery could not be confirmed."); }
}
const sourceSchema = z.object({ kind: z.enum(NOTIFICATION_KINDS), audience: z.enum(NOTIFICATION_AUDIENCES), data: z.object({ status: z.string().regex(/^[A-Z_]{1,40}$/).optional() }).strict() });
export function inboxAudiences(role: string) {
  if (role === "ADMIN") return [...NOTIFICATION_AUDIENCES];
  if (role === "MEMBER") return ["ACCOUNT", "SELLER"];
  if (role === "USER") return ["ACCOUNT"];
  throw new NotificationError("Current inbox access is required.", "NOTIFICATION_FORBIDDEN", 403);
}
export function notificationMessage(source: { kind: string; audience: string; data: unknown }) {
  const parsed = sourceSchema.safeParse(source); if (!parsed.success) throw new NotificationDeliveryError("INVALID_NOTIFICATION_EVENT");
  const { kind, audience, data } = parsed.data;
  const status = data.status ? data.status.toLowerCase().replace(/_/g, " ") : "updated";
  const messages: Record<typeof kind, [string, string]> = {
    SELLER_APPLICATION: ["Seller application received", "A verified seller application was submitted for administrator review."],
    SELLER_STATUS: ["Seller account decision", `Your seller account status was recorded as ${status}.`],
    ACCOUNT_ACCESS: ["Account access updated", "An account access or verification change was recorded. Review your current account details."],
    PRODUCT_REVIEW: ["Product review requested", "A product submission or revision was queued for administrator review."],
    PRODUCT_STATUS: ["Product decision recorded", `Product status was recorded as ${status}. Open the current catalog details.`],
    ORDER_PLACED: ["Order recorded", "An order was recorded. Review its current order and shipment details."],
    ORDER_STATUS: ["Order status updated", `Order status was recorded as ${status}.`],
    PAYMENT_STATUS: ["Payment status updated", `Payment status was recorded as ${status}. Review the current payment or earnings state.`],
    SHIPMENT_ASSIGNED: ["Seller shipment assigned", "A shipment was assigned to your seller account. Review your own items and current fulfillment state."],
    SHIPMENT_STATUS: ["Seller shipment updated", `Shipment status was recorded as ${status}. Review its current delivery and collection details.`],
    REFUND_STATUS: ["Refund status updated", `Refund status was recorded as ${status}. Review current reimbursement or earnings details.`],
    DISPUTE_STATUS: ["Payment dispute update", "A payment dispute update was recorded. Review the current financial state."],
    PAYOUT_STATUS: ["Seller payout updated", `Payout instruction status was recorded as ${status}. A reservation alone does not confirm an external transfer.`],
    COMMERCIAL_POLICY: ["Future commercial terms updated", "Commercial policy was updated for future purchases. Captured purchase terms remain unchanged."],
  };
  let href: string;
  if (audience === "ACCOUNT") href = kind === "ACCOUNT_ACCESS" ? "/user/profile" : "/user/orders";
  else if (audience === "ADMIN") href = kind === "SELLER_APPLICATION" ? "/admin/members" : ["PRODUCT_REVIEW", "PRODUCT_STATUS"].includes(kind) ? "/admin/products" : ["PAYOUT_STATUS", "COMMERCIAL_POLICY"].includes(kind) ? "/admin/settlements" : "/admin/orders";
  else href = kind === "PRODUCT_STATUS" ? "/member/products" : ["SHIPMENT_ASSIGNED", "SHIPMENT_STATUS", "ORDER_STATUS", "ORDER_PLACED"].includes(kind) ? "/member/orders" : kind === "PAYOUT_STATUS" ? "/member/payouts" : ["PAYMENT_STATUS", "REFUND_STATUS", "DISPUTE_STATUS", "COMMERCIAL_POLICY"].includes(kind) ? "/member/earnings" : "/member/dashboard";
  return { title: messages[kind][0], body: messages[kind][1], href };
}
