ALTER TABLE "Order"
  ADD COLUMN "reservationExpiresAt" TIMESTAMP(3),
  ADD COLUMN "reservationNextCheckAt" TIMESTAMP(3),
  ADD COLUMN "reservationReviewReason" TEXT,
  ADD COLUMN "stripeSessionRequestedAt" TIMESTAMP(3),
  ADD COLUMN "stripeCheckoutSessionId" TEXT,
  ADD COLUMN "stripeCheckoutOrigin" TEXT;

-- Earlier revisions did not record whether Stripe received a session request.
-- Never infer "no provider session" from a missing ID on these legacy orders.
UPDATE "Order" SET
  "stripeSessionRequestedAt" = "createdAt",
  "reservationExpiresAt" = "createdAt" + INTERVAL '24 hours',
  "reservationNextCheckAt" = "createdAt" + INTERVAL '24 hours',
  "reservationReviewReason" = 'LEGACY_SESSION_UNKNOWN'
WHERE "paymentMethod" = 'STRIPE' AND "status" = 'PENDING' AND "paymentStatus" = 'UNPAID';

CREATE UNIQUE INDEX "Order_stripeCheckoutSessionId_key" ON "Order"("stripeCheckoutSessionId");
CREATE INDEX "Order_reservation_sweep_idx"
  ON "Order"("paymentMethod", "status", "paymentStatus", "reservationNextCheckAt");
