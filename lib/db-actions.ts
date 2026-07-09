import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export async function processOrderCheckout({
  userId,
  cartItems,
  paymentIntentId,
}: {
  userId: string;
  cartItems: { productId: string; quantity: number }[];
  paymentIntentId: string;
}) {
  return await prisma.$transaction(async (tx) => {
    let totalAmount = new Prisma.Decimal(0);
    const orderItemsData = [];

    for (const item of cartItems) {
      // Find the product first to retrieve price/name metadata
      const product = await tx.product.findUnique({
        where: { id: item.productId },
      });

      if (!product) {
        throw new Error(`Product not found: ${item.productId}`);
      }

      if (product.stock < item.quantity) {
        throw new Error(`Insufficient stock for product: ${product.name}`);
      }

      // Decrement inventory atomically at database-level
      const updatedProduct = await tx.product.update({
        where: { id: item.productId },
        data: { stock: { decrement: item.quantity } },
      });

      // Strict post-update check to prevent concurrent race conditions
      if (updatedProduct.stock < 0) {
        throw new Error(`Concurrency check failed: Insufficient stock for product: ${product.name}`);
      }

      // Safe decimal arithmetic to prevent precision issues
      const itemTotal = product.price.mul(item.quantity);
      totalAmount = totalAmount.add(itemTotal);

      orderItemsData.push({
        productId: item.productId,
        quantity: item.quantity,
        price: product.price,
      });
    }

    // Create the completed order record
    const order = await tx.order.create({
      data: {
        userId,
        total: totalAmount,
        status: "PAID",
        paymentIntentId,
        items: {
          create: orderItemsData,
        },
      },
      include: {
        items: true,
      },
    });

    return order;
  });
}
