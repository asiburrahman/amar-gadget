"use server";

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkoutSchema, type CheckoutInput } from "@/lib/validations/order";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getCurrentUser, getCurrentUserWithRole } from "@/lib/session";

function hashCheckoutToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function matchesCheckoutToken(token: string, tokenHash: string | null) {
  if (!tokenHash) return false;
  const candidate = Buffer.from(hashCheckoutToken(token), "hex");
  const stored = Buffer.from(tokenHash, "hex");
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

export async function createOrder(input: CheckoutInput) {
  try {
    const validated = checkoutSchema.parse(input);
    const currentUser = await getCurrentUser();
    const checkoutToken = randomBytes(32).toString("hex");

    const order = await prisma.$transaction(async (tx) => {
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

      if (!user) throw new Error("Your account is no longer available. Please sign in again.");

      let subtotal = new Prisma.Decimal(0);
      const orderItems = [];

      for (const item of validated.items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
          include: { seller: { select: { sellerStatus: true } } },
        });

        if (
          !product ||
          product.status !== "APPROVED" ||
          product.seller.sellerStatus !== "APPROVED"
        ) {
          throw new Error("One or more selected products are no longer available.");
        }

        const stockUpdate = await tx.product.updateMany({
          where: { id: product.id, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        });
        if (stockUpdate.count !== 1) {
          throw new Error(`Insufficient stock for ${product.name}.`);
        }

        const unitPrice = product.discountPrice ?? product.price;
        subtotal = subtotal.add(unitPrice.mul(item.quantity));
        orderItems.push({
          productId: product.id,
          quantity: item.quantity,
          price: unitPrice,
        });
      }

      let total = subtotal;
      if (validated.couponCode) {
        const coupon = await tx.coupon.findUnique({
          where: { code: validated.couponCode.trim().toUpperCase() },
        });
        const couponIsValid =
          coupon?.isActive &&
          (!coupon.expiresAt || coupon.expiresAt >= new Date()) &&
          (!coupon.minSpend || subtotal.gte(coupon.minSpend));

        if (!couponIsValid || !coupon) {
          throw new Error("The coupon code is invalid, expired, or does not meet the minimum spend.");
        }

        if (coupon.discount.lte(0)) {
          throw new Error("The coupon code is invalid.");
        }
        if (coupon.isPercentage) {
          const percentage = Math.min(100, Math.max(0, Number(coupon.discount)));
          total = total.mul(100 - percentage).div(100);
        } else {
          total = Prisma.Decimal.max(0, total.sub(Prisma.Decimal.max(0, coupon.discount)));
        }
      }

      const shippingFee = subtotal.gt(0) && subtotal.lte(50000) ? 150 : 0;
      total = total.add(shippingFee);
      if (validated.paymentMethod === "STRIPE" && total.lt(1)) {
        throw new Error("Card checkout requires an order total of at least BDT 1.");
      }

      return tx.order.create({
        data: {
          userId: user.id,
          total,
          status: validated.paymentMethod === "COD" ? "PROCESSING" : "PENDING",
          paymentMethod: validated.paymentMethod,
          paymentStatus: "UNPAID",
          shippingAddress: `${validated.fullName} (${validated.phone}), ${validated.street}, ${validated.city}, ${validated.district} ${validated.zipCode || ""}`,
          shippingPhone: validated.phone,
          trackingNumber: `AG-${randomBytes(4).toString("hex").toUpperCase()}`,
          couponCode: validated.couponCode?.trim().toUpperCase() || null,
          checkoutTokenHash: hashCheckoutToken(checkoutToken),
          items: { create: orderItems },
        },
        select: { id: true, trackingNumber: true },
      });
    });

    revalidatePath("/user/orders");
    revalidatePath("/admin/orders");
    (await cookies()).set("order_access_token", checkoutToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24,
      path: `/order-success/${order.id}`,
    });
    return {
      success: true as const,
      orderId: order.id,
      trackingNumber: order.trackingNumber,
      ...(validated.paymentMethod === "STRIPE" ? { checkoutToken } : {}),
    };
  } catch (error) {
    console.error("Error creating order:", error);
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Failed to process order",
    };
  }
}

export async function getUserOrders() {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Unauthorized", data: [] };

  try {
    const orders = await prisma.order.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        total: true,
        status: true,
        paymentMethod: true,
        paymentStatus: true,
        shippingAddress: true,
        trackingNumber: true,
        createdAt: true,
        items: {
          select: {
            id: true,
            quantity: true,
            price: true,
            product: { select: { id: true, name: true, imageUrl: true, slug: true } },
          },
        },
      },
    });

    return {
      success: true,
      data: orders.map((order) => ({
        ...order,
        total: Number(order.total),
        items: order.items.map((item) => ({ ...item, price: Number(item.price) })),
      })),
    };
  } catch (error) {
    console.error("Error fetching customer orders:", error);
    return { success: false, error: "Failed to fetch orders", data: [] };
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
        shippingAddress: true,
        trackingNumber: true,
        createdAt: true,
        checkoutTokenHash: true,
        items: {
          select: {
            id: true,
            quantity: true,
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
      (accessToken !== undefined &&
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
        shippingAddress: order.shippingAddress,
        trackingNumber: order.trackingNumber,
        createdAt: order.createdAt,
        items: order.items.map((item) => ({
          ...item,
          price: Number(item.price),
        })),
      },
    };
  } catch (error) {
    console.error("Error fetching order:", error);
    return { success: false, error: "Error fetching order", data: null };
  }
}

export async function getSellerOrders() {
  const seller = await getCurrentUserWithRole(["MEMBER"]);
  if (!seller || seller.sellerStatus !== "APPROVED") {
    return { success: false, error: "Unauthorized", data: [] };
  }

  try {
    const orderItems = await prisma.orderItem.findMany({
      where: { product: { sellerId: seller.id } },
      orderBy: { createdAt: "desc" },
      include: {
        order: {
          include: {
            user: { select: { name: true, email: true, phone: true } },
          },
        },
        product: { select: { id: true, name: true, imageUrl: true, price: true } },
      },
    });

    const data = orderItems.map((item) => ({
      id: item.id,
      orderId: item.orderId,
      productId: item.productId,
      quantity: item.quantity,
      price: Number(item.price),
      createdAt: item.createdAt,
      product: { ...item.product, price: Number(item.product.price) },
      order: {
        id: item.order.id,
        userId: item.order.userId,
        total: Number(item.order.total),
        status: item.order.status,
        paymentMethod: item.order.paymentMethod,
        paymentStatus: item.order.paymentStatus,
        shippingAddress: item.order.shippingAddress,
        trackingNumber: item.order.trackingNumber,
        createdAt: item.order.createdAt,
        user: item.order.user,
      },
    }));

    return { success: true, data };
  } catch (error) {
    console.error("Error fetching seller orders:", error);
    return { success: false, error: "Failed to fetch vendor orders", data: [] };
  }
}

export async function updateOrderStatusBySeller(orderId: string, newStatus: string) {
  const seller = await getCurrentUserWithRole(["MEMBER"]);
  if (!seller || seller.sellerStatus !== "APPROVED") {
    return { success: false, error: "Unauthorized" };
  }
  if (newStatus !== "SHIPPED") {
    return { success: false, error: "Invalid order status." };
  }

  try {
    const orderItem = await prisma.orderItem.findFirst({
      where: { orderId, product: { sellerId: seller.id } },
      include: {
        order: {
          select: { paymentMethod: true, paymentStatus: true, status: true },
        },
      },
    });
    if (!orderItem) return { success: false, error: "Order not found or permission denied." };
    if (orderItem.order.status !== "PROCESSING") {
      return { success: false, error: "Only processing orders can be shipped." };
    }
    if (orderItem.order.paymentMethod === "STRIPE" && orderItem.order.paymentStatus !== "PAID") {
      return { success: false, error: "Card payment must be confirmed before shipping." };
    }

    const [orderItemCount, sellerItemCount] = await Promise.all([
      prisma.orderItem.count({ where: { orderId } }),
      prisma.orderItem.count({ where: { orderId, product: { sellerId: seller.id } } }),
    ]);
    if (orderItemCount !== sellerItemCount) {
      return { success: false, error: "A multi-seller order must be shipped by an administrator." };
    }

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: { status: newStatus },
      select: { id: true, status: true, paymentStatus: true },
    });

    revalidatePath("/member/dashboard");
    revalidatePath("/admin/orders");
    revalidatePath("/user/orders");
    revalidatePath("/user/dashboard");
    return { success: true, data: updated };
  } catch (error) {
    console.error("Error updating order status by seller:", error);
    return { success: false, error: "Failed to update order status." };
  }
}

export async function getAllOrdersForAdmin() {
  if (!(await getCurrentUserWithRole(["ADMIN"]))) {
    return { success: false, error: "Unauthorized", data: [] };
  }

  try {
    const orders = await prisma.order.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        total: true,
        status: true,
        paymentMethod: true,
        paymentStatus: true,
        shippingAddress: true,
        trackingNumber: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true, phone: true } },
        items: {
          select: {
            id: true,
            quantity: true,
            price: true,
            product: { select: { id: true, name: true, imageUrl: true, price: true } },
          },
        },
      },
    });

    return {
      success: true,
      data: orders.map((order) => ({
        ...order,
        total: Number(order.total),
        items: order.items.map((item) => ({
          ...item,
          price: Number(item.price),
          product: { ...item.product, price: Number(item.product.price) },
        })),
      })),
    };
  } catch (error) {
    console.error("Error fetching admin orders:", error);
    return { success: false, error: "Failed to fetch orders", data: [] };
  }
}

export async function updateOrderStatusByAdmin(orderId: string, newStatus: string) {
  if (!(await getCurrentUserWithRole(["ADMIN"]))) {
    return { success: false, error: "Unauthorized" };
  }
  if (!["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"].includes(newStatus)) {
    return { success: false, error: "Invalid order status." };
  }

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        status: true,
        paymentMethod: true,
        paymentStatus: true,
        items: { select: { productId: true, quantity: true } },
      },
    });
    if (!order) return { success: false, error: "Order not found." };
    if (newStatus === "CANCELLED" && order.status === "CANCELLED") {
      return { success: false, error: "Order is already cancelled." };
    }
    const allowedTransitions: Record<string, string[]> = {
      PENDING: ["PROCESSING", "CANCELLED"],
      PROCESSING: ["SHIPPED", "DELIVERED", "CANCELLED"],
      SHIPPED: ["DELIVERED"],
      DELIVERED: [],
      CANCELLED: [],
    };
    if (!allowedTransitions[order.status]?.includes(newStatus)) {
      return { success: false, error: "That order status transition is not allowed." };
    }
    if (
      newStatus === "PROCESSING" &&
      order.paymentMethod === "STRIPE" &&
      order.paymentStatus !== "PAID"
    ) {
      return { success: false, error: "Card payment must be confirmed before processing." };
    }
    if (newStatus === "CANCELLED" && order.paymentStatus === "PAID") {
      return { success: false, error: "Paid orders must be refunded before they can be cancelled." };
    }
    if (
      newStatus === "DELIVERED" &&
      order.paymentMethod === "STRIPE" &&
      order.paymentStatus !== "PAID"
    ) {
      return { success: false, error: "Card payment must be confirmed before delivery." };
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.order.updateMany({
        where: {
          id: orderId,
          status: order.status,
          paymentStatus: order.paymentStatus,
        },
        data: {
          status: newStatus,
          ...(newStatus === "DELIVERED" && order.paymentMethod === "COD"
            ? { paymentStatus: "PAID" }
            : {}),
          ...(newStatus === "CANCELLED" && order.paymentMethod === "STRIPE"
            ? { paymentStatus: "FAILED" }
            : {}),
        },
      });
      if (result.count !== 1) throw new Error("The order changed. Refresh and try again.");

      if (newStatus === "CANCELLED") {
        for (const item of order.items) {
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.quantity } },
          });
        }
      }

      return tx.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { id: true, status: true, paymentStatus: true },
      });
    });

    revalidatePath("/admin/orders");
    revalidatePath("/user/orders");
    revalidatePath("/user/dashboard");
    revalidatePath("/member/dashboard");
    return { success: true, data: updated };
  } catch (error) {
    console.error("Error updating order status by admin:", error);
    return { success: false, error: "Failed to update order status." };
  }
}
