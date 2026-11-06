BEGIN;
LOCK TABLE "OtpToken" IN ACCESS EXCLUSIVE MODE;
-- Old tokens have no trustworthy purpose/requester binding. Invalidate only
-- these short-lived credentials; preserve every account/password/order.
DELETE FROM "OtpToken";
DROP INDEX "OtpToken_email_idx";
ALTER TABLE "OtpToken"
  DROP COLUMN "code",
  ADD COLUMN "userId" TEXT NOT NULL,
  ADD COLUMN "purpose" TEXT NOT NULL,
  ADD COLUMN "codeHash" VARCHAR(64) NOT NULL,
  ADD COLUMN "accountFingerprint" VARCHAR(64) NOT NULL,
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deliveredAt" TIMESTAMP(3),
  ADD CONSTRAINT "OtpToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "OtpToken_purpose_check" CHECK ("purpose" IN ('REGISTRATION', 'PASSWORD_RESET', 'EMAIL_CHANGE')),
  ADD CONSTRAINT "OtpToken_attempts_check" CHECK ("attempts" BETWEEN 0 AND 5);
CREATE UNIQUE INDEX "OtpToken_userId_purpose_key" ON "OtpToken"("userId", "purpose");
CREATE INDEX "OtpToken_email_purpose_expiresAt_idx" ON "OtpToken"("email", "purpose", "expiresAt");

CREATE TABLE "OtpThrottle" (
  "userId" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "verificationWindowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verificationAttempts" INTEGER NOT NULL DEFAULT 0,
  "sendWindowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sendCount" INTEGER NOT NULL DEFAULT 0,
  "lastSentAt" TIMESTAMP(3),
  CONSTRAINT "OtpThrottle_pkey" PRIMARY KEY ("userId", "purpose"),
  CONSTRAINT "OtpThrottle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OtpThrottle_purpose_check" CHECK ("purpose" IN ('REGISTRATION', 'PASSWORD_RESET', 'EMAIL_CHANGE')),
  CONSTRAINT "OtpThrottle_attempts_check" CHECK ("verificationAttempts" BETWEEN 0 AND 5),
  CONSTRAINT "OtpThrottle_sends_check" CHECK ("sendCount" BETWEEN 0 AND 3)
);
COMMIT;
