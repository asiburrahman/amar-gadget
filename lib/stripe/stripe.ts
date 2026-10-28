import Stripe from "stripe";

export function getStripe(config: NonNullable<ConstructorParameters<typeof Stripe>[1]> = {}) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY must be configured to use Stripe.");
  }

  return new Stripe(secretKey, { timeout: 10_000, maxNetworkRetries: 1, ...config });
}
