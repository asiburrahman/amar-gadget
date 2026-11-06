-- Keep requests prepared by the previous release on their original parameters.
ALTER TABLE "Order" ADD COLUMN "stripeCheckoutVersion" INTEGER NOT NULL DEFAULT 1;
