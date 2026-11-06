import Stripe from "stripe";
import { readStripeSecret } from "@/config/runtime";

export function getStripe(config: NonNullable<ConstructorParameters<typeof Stripe>[1]> = {}) {
  const secretKey = readStripeSecret();

  return new Stripe(secretKey, { timeout: 10_000, maxNetworkRetries: 1, ...config });
}
