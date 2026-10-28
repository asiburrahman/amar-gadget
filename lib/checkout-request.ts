import type { CheckoutDetails } from "@/lib/validations/order";

/** Stable representation for request binding, including the current identity. */
export function canonicalCheckoutRequest(input: CheckoutDetails, accountId: string | null): string {
  return JSON.stringify({
    accountId,
    items: input.items.map((item) => ({ productId: item.productId, quantity: item.quantity }))
      .sort((a, b) => a.productId.localeCompare(b.productId)),
    fullName: input.fullName.trim(),
    phone: input.phone.trim(),
    street: input.street.trim(),
    city: input.city.trim(),
    district: input.district.trim(),
    zipCode: input.zipCode?.trim() || "",
    paymentMethod: input.paymentMethod,
    couponCode: input.couponCode?.trim().toUpperCase() || "",
  });
}
