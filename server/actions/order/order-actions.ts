"use server";

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { purchasedProduct } from "@/lib/purchase-product-label";
import { ZodError } from "zod";
import { calculateCheckoutQuote, CheckoutQuoteError } from "@/lib/checkout-quote";
import { prisma } from "@/lib/prisma";
import { checkoutSchema, type CheckoutInput } from "@/lib/validations/order";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { getCurrentUser, getCurrentUserWithRole } from "@/lib/session";
import { canonicalCheckoutRequest } from "@/lib/checkout-request";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { INITIAL_RESERVATION_MS } from "@/lib/checkout-reservations";
import { prepareCartCheckout, consumeCartForOrder } from "@/lib/cart-checkout";
import { CartError } from "@/lib/cart";
import { FulfillmentError } from "@/lib/fulfillment-policy";
import { invalidateFulfillmentPages } from "@/lib/fulfillment-request";
import { customerShipmentSelect, customerShipment, readSellerFulfillments, mutateFulfillment, mutateWholeOrder } from "@/lib/fulfillments";
import { allocateDiscount, cents } from "@/lib/refund-policy";
import { readCustomerOrders } from "@/lib/customer-orders-read";
import { readAdminOrders } from "@/lib/admin-orders-read";
import { ReadAccessError, ReadPageError } from "@/lib/protected-read";
import { serviceUnavailable } from "@/lib/observability";
import { withOrderTrackingRetry } from "@/lib/order-tracking-code";

function hashCheckoutToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function matchesCheckoutToken(token: string, tokenHash: string | null) {
  if (!tokenHash) return false;
  const candidate = Buffer.from(hashCheckoutToken(token), "hex");
  const stored = Buffer.from(tokenHash, "hex");
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

class CheckoutError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

const checkoutResultSelect = {
  id: true, trackingNumber: true, status: true, paymentStatus: true, reservationExpiresAt: true,
} satisfies Prisma.OrderSelect;

export async function createOrder(input: CheckoutInput) {
  try {
    const validated = checkoutSchema.parse(input);
    const currentUser = await getCurrentUser();
    const ip = getClientIp(await headers());
    const ipLimit = await rateLimit(ip, 30, 60, "checkout-create-ip");
    const actor = currentUser?.id ?? validated.phone.replace(/\D/g, "");
    const actorLimit = ipLimit.success && await rateLimit(
      createHash("sha256").update(actor).digest("hex"), 10, 60,
      currentUser ? "checkout-create-account" : "checkout-create-contact",
    );
    if (!ipLimit.success || !actorLimit || !actorLimit.success) {
      return { success: false as const, code: "RATE_LIMITED", error: "Too many checkout attempts. Please wait a minute and try again." };
    }
    const checkoutToken = validated.checkoutToken;
    const tokenHash = hashCheckoutToken(checkoutToken);
    const requestHash = createHash("sha256")
      .update(canonicalCheckoutRequest(validated, currentUser?.id ?? null)).digest("hex");

    const order = await withOrderTrackingRetry((trackingNumber) => prisma.$transaction(async (tx) => {
      // Serialize the same attempt across requests/processes before any guest
      // or stock writes. The database releases this lock on commit/rollback.
      // Only a constant hash is sent as a parameter; no token/PII enters SQL.
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${tokenHash}, 0))`;
      const existing = await tx.order.findUnique({
        where: { checkoutTokenHash: tokenHash },
        select: { ...checkoutResultSelect, checkoutRequestHash: true },
      });
      if (existing) {
        if (existing.checkoutRequestHash !== requestHash) {
          throw new CheckoutError("This checkout attempt belongs to different details. Start a new checkout.", "CHECKOUT_CONFLICT");
        }
        return existing;
      }
      const cartSnapshot = await prepareCartCheckout(tx, validated, currentUser);
      // Serialize redemption with administrative rule changes through commit.
      if (validated.couponCode) await tx.$queryRaw`SELECT id FROM "Coupon" WHERE code=${validated.couponCode} FOR SHARE`;
      const quote = await calculateCheckoutQuote(tx, validated);
      if (validated.quoteFingerprint && validated.quoteFingerprint !== quote.fingerprint) {
        throw new CheckoutError("Prices or discounts changed. Review the refreshed total before placing your order.", "QUOTE_CHANGED");
      }
      const user = currentUser
        ? await tx.user.findUnique({ where: { id: currentUser.id } })
        : await tx.user.create({
            data: {
              email: `guest-${randomUUID()}@guest.amargadget.invalid`,
              name: validated.fullName,
              phone: validated.phone,
              role: "USER",
              isVerified: false,
            },
          });

      if (!user) throw new CheckoutError("Your account is no longer available. Please sign in again.", "ACCOUNT_UNAVAILABLE");

      const allocations = allocateDiscount(quote.items.map((item) => ({ id: item.productId, grossCents: cents(item.lineTotal) })), cents(quote.discountAmount));
      const orderItems = [];
      for (const item of quote.items) {
        const updated = await tx.product.updateMany({
          where: { id: item.productId, stock: { gte: item.quantity }, status: "APPROVED", seller: { sellerStatus: "APPROVED" } },
          data: { stock: { decrement: item.quantity } },
        });
        if (updated.count !== 1) throw new CheckoutError("A product is no longer available in the requested quantity.", "OUT_OF_STOCK");
        orderItems.push({ productId: item.productId, quantity: item.quantity, price: new Prisma.Decimal(item.unitPrice), netCents: BigInt(allocations.find((line) => line.id === item.productId)!.netCents) });
      }
      const total = new Prisma.Decimal(quote.total);

      const created = await tx.order.create({
        data: {
          userId: user.id,
          total,
          subtotalCents: BigInt(cents(quote.subtotal)), discountCents: BigInt(cents(quote.discountAmount)), shippingCents: BigInt(cents(quote.shippingFee)),
          pricingEvidence: "CHECKOUT_QUOTE_V1", pricingReconciledAt: new Date(),
          status: validated.paymentMethod === "COD" ? "PROCESSING" : "PENDING",
          paymentMethod: validated.paymentMethod,
          paymentStatus: "UNPAID",
          shippingAddress: `${validated.fullName} (${validated.phone}), ${validated.street}, ${validated.city}, ${validated.district} ${validated.zipCode || ""}`,
          shippingPhone: validated.phone,
          trackingNumber,
          couponCode: validated.couponCode?.trim().toUpperCase() || null,
          checkoutTokenHash: tokenHash,
          checkoutRequestHash: requestHash,
          ...(cartSnapshot ? { cartSnapshot } : {}),
          ...(validated.paymentMethod === "STRIPE" ? {
            reservationExpiresAt: new Date(Date.now() + INITIAL_RESERVATION_MS),
            reservationNextCheckAt: new Date(Date.now() + INITIAL_RESERVATION_MS),
          } : {}),
          items: { create: orderItems },
        },
        select: checkoutResultSelect,
      });
      if (cartSnapshot && validated.paymentMethod === "COD") await consumeCartForOrder(tx, created.id);
      return created;
    }));

    if (order.status === "CANCELLED" || order.paymentStatus === "FAILED") {
      return { success: false as const, code: "CHECKOUT_CLOSED", error: "This checkout is closed. Start a new checkout to place another order." };
    }

    // The transaction is already committed. A cache invalidation or response
    // cookie failure must not turn a saved order into a false creation error.
    try { revalidatePath("/user/orders"); revalidatePath("/admin/orders"); }
    catch { console.warn("Order saved; order-list cache refresh deferred."); }
    let receiptRecoveryRequired = false;
    try {
      const cookieStore = await cookies();
      cookieStore.set("order_access_token", checkoutToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24,
        path: `/order-success/${order.id}`,
      });
      cookieStore.set("checkout_resume_token", checkoutToken, {
        httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
        maxAge: 60 * 60 * 24, path: `/api/checkout/${order.id}`,
      });
    } catch { receiptRecoveryRequired = true; console.warn("Order saved; original checkout attempt is required to recover receipt access."); }
    return {
      success: true as const,
      orderId: order.id,
      trackingNumber: order.trackingNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      ...(receiptRecoveryRequired ? { receiptRecoveryRequired: true } : {}),
      ...(validated.paymentMethod === "STRIPE" ? { checkoutToken } : {}),
    };
  } catch (error) {
    if (error instanceof CartError) return { success: false as const, code: error.code, error: error.message, ...(error.resumeOrderId ? { resumeOrderId: error.resumeOrderId } : {}) };
    if (error instanceof ZodError) {
      return { success: false as const, code: "INVALID_CHECKOUT", error: "Check your cart and shipping details, then try again." };
    }
    if (error instanceof CheckoutError || error instanceof CheckoutQuoteError) {
      return { success: false as const, code: error.code, error: error.message };
    }
    // Never return database/provider exception details to a public action.
    const incident = serviceUnavailable("checkout.create", error).incident;
    return {
      success: false as const,
      code: "INTERNAL_ERROR",
      error: "Unable to process checkout right now. Please try again.",
      reference: incident.reference,
    };
  }
}

export async function getUserOrders(query: unknown = {}) {
  try {
    const user = await getCurrentUser();
    if (!user) return { success: false, error: "Unauthorized", data: [] };
    const { orders, counts, total, page, pageSize, totalPages } = await readCustomerOrders(user, query);
    return {
      success: true,
      pagination: { total, page, pageSize, totalPages }, counts,
      data: orders.map((order) => ({
        id: order.id, status: order.status, paymentMethod: order.paymentMethod, paymentStatus: order.paymentStatus,
        shippingAddress: order.shippingAddress, trackingNumber: order.trackingNumber, createdAt: order.createdAt,
        total: Number(order.total),
        items: order.items.map((item) => ({ id: item.id, quantity: item.quantity, productName: item.productName, productSlug: item.productSlug, productSnapshotSource: item.productSnapshotSource, price: Number(item.price), product: purchasedProduct(item) })),
      })),
    };
  } catch (error) {
    if (error instanceof ReadAccessError) return { success: false, error: "Unauthorized", data: [] };
    if (error instanceof ZodError) return { success: false, error: "Invalid order search, status or page.", data: [] };
    if (error instanceof ReadPageError) return { success: false, error: error.message, data: [] };
    const unavailable = serviceUnavailable("customer.orders.action", error);
    return { success: false, error: "Order history is temporarily unavailable. Try again shortly.", reference: unavailable.digest, data: [] };
  }
}

export async function getOrderById(orderId: string, checkoutToken?: string) {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        userId: true,
        total: true,
        status: true,
        paymentMethod: true,
        paymentStatus: true,
        refundState: true, refundedCents: true, disputeStatus: true, disputeAmountCents: true, financialReviewReason: true,
        shippingAddress: true,
        trackingNumber: true,
        createdAt: true,
        checkoutTokenHash: true,
        reservationReviewReason: true,
        cartSnapshot: true,
        fulfillments: { where: { items: { some: {} } }, orderBy: { id: "asc" }, select: customerShipmentSelect },
        items: {
          select: {
            id: true,
            quantity: true,
            productName: true, productSlug: true, productSnapshotSource: true,
            price: true,
            product: { select: { id: true, name: true, imageUrl: true, slug: true } },
          },
        },
      },
    });

    if (!order) return { success: false, error: "Order not found", data: null };

    const currentUser = await getCurrentUser();
    const accessToken =
      checkoutToken ?? (await cookies()).get("order_access_token")?.value;
    const authorized =
      currentUser?.role.toUpperCase() === "ADMIN" ||
      currentUser?.id === order.userId ||
      (!currentUser && accessToken !== undefined &&
        matchesCheckoutToken(accessToken, order.checkoutTokenHash));

    if (!authorized) return { success: false, error: "Order not found", data: null };

    return {
      success: true,
      data: {
        id: order.id,
        total: Number(order.total),
        status: order.status,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        refundState: order.refundState, refundedAmount: Number(order.refundedCents) / 100, disputeStatus: order.disputeStatus, disputeLossAmount: Number(order.disputeAmountCents) / 100,
        shippingAddress: order.shippingAddress,
        trackingNumber: order.trackingNumber,
        createdAt: order.createdAt,
        canViewOrders: currentUser?.id === order.userId,
        needsReview: Boolean(order.reservationReviewReason || order.financialReviewReason || ["ACTIVE", "LOST"].includes(order.disputeStatus)),
        cartSnapshot: order.cartSnapshot,
        fulfillments: order.fulfillments.map(customerShipment),
        items: order.items.map((item) => ({
          ...item,
          product: purchasedProduct(item),
          price: Number(item.price),
        })),
      },
    };
  } catch (error) {
    console.error("Error fetching order:", error);
    return { success: false, error: "Error fetching order", code: "ORDER_UNAVAILABLE", data: null };
  }
}

export async function getSellerOrders(query: unknown = {}) {
  const seller = await getCurrentUserWithRole(["MEMBER"]);
  if (!seller || seller.sellerStatus !== "APPROVED") return { success: false as const, error: "Unauthorized", data: [] };
  try { const result = await readSellerFulfillments(seller, query); return { success: true as const, data: result.shipments, page: result.page, total: result.total, totalPages: result.totalPages }; }
  catch { return { success: false as const, error: "Unable to load your shipments.", data: [] }; }
}

export async function updateOrderStatusBySeller(fulfillmentId: string, newStatus: string, context?: { ownerId: string; version: number; carrier: string; trackingNumber: string }) {
  const actor = await getCurrentUserWithRole(["MEMBER"]);
  if (!actor || actor.sellerStatus !== "APPROVED") return { success: false as const, error: "Unauthorized" };
  if (newStatus !== "SHIPPED" || !context || context.ownerId !== actor.id) return { success: false as const, error: "Use your shipment's current revision and carrier details to ship it." };
  try {
    const saved = await mutateFulfillment(actor, { fulfillmentId, action: "ship", version: context.version, carrier: context.carrier, trackingNumber: context.trackingNumber });
    invalidateFulfillmentPages(saved.shipment.orderId); return { success: true as const, data: saved.shipment };
  } catch (error) { return { success: false as const, error: error instanceof FulfillmentError ? error.message : "Unable to confirm shipment. Reload before retrying." }; }
}

export async function getAllOrdersForAdmin(query: unknown = {}) {
  try {
    const actor = await getCurrentUserWithRole(["ADMIN"]);
    if (!actor) return { success: false, error: "Unauthorized", data: [] };
    const { orders, ...pageData } = await readAdminOrders(actor, query);
    return { success: true, data: orders, pageData };
  } catch (error) {
    if (error instanceof ReadAccessError) return { success: false, error: "Unauthorized", data: [] };
    if (error instanceof ZodError) return { success: false, error: "Invalid order search, status or page.", data: [] };
    if (error instanceof ReadPageError) return { success: false, error: error.message, data: [] };
    const unavailable = serviceUnavailable("admin.orders.action", error);
    return { success: false, error: "Platform orders are temporarily unavailable. Try again shortly.", reference: unavailable.digest, data: [] };
  }
}

export async function updateOrderStatusByAdmin(orderId: string, newStatus: string, context?: { ownerId: string; version: number }) {
  const actor = await getCurrentUserWithRole(["ADMIN"]);
  if (!actor) return { success: false as const, error: "Unauthorized" };
  if (!context || context.ownerId !== actor.id || !["PROCESSING", "CANCELLED"].includes(newStatus)) return { success: false as const, error: "Use the current order revision to confirm or cancel an order. Ship and deliver each vendor shipment separately." };
  try {
    const data = await mutateWholeOrder(actor, { orderId, ...context, action: newStatus === "CANCELLED" ? "cancel" : "confirm" });
    invalidateFulfillmentPages(orderId); return { success: true as const, data };
  } catch (error) { return { success: false as const, error: error instanceof FulfillmentError ? error.message : "Unable to confirm this order change. Reload before retrying." }; }
}
