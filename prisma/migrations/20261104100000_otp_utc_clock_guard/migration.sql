BEGIN;
SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '30000ms';
LOCK TABLE "OtpThrottle", "OtpToken" IN ACCESS EXCLUSIVE MODE;

-- Previous raw timestamptz decoding could persist local wall time as UTC.
-- Never reinterpret a credential's remaining lifetime during this transition.
-- Invalidate only short-lived OTP credentials, not accounts or sessions.
DELETE FROM "OtpToken";

-- Preserve every consumed send/verification allowance. Conservatively start
-- one fresh ten-minute window, with at most the normal resend cooldown.
UPDATE "OtpThrottle" SET
  "verificationWindowStart" = timezone('UTC',clock_timestamp()),
  "sendWindowStart" = timezone('UTC',clock_timestamp()),
  "lastSentAt" = CASE WHEN "lastSentAt" IS NULL THEN NULL ELSE timezone('UTC',clock_timestamp()) END;

ALTER TABLE "OtpToken" ALTER COLUMN "createdAt" SET DEFAULT timezone('UTC',CURRENT_TIMESTAMP);
ALTER TABLE "OtpThrottle"
  ALTER COLUMN "verificationWindowStart" SET DEFAULT timezone('UTC',CURRENT_TIMESTAMP),
  ALTER COLUMN "sendWindowStart" SET DEFAULT timezone('UTC',CURRENT_TIMESTAMP);

-- Old application instances must not reintroduce future-dated credentials or
-- throttle windows after migration. Expiring a credential early is allowed.
CREATE FUNCTION guard_otp_utc_clock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE utc_now TIMESTAMP := timezone('UTC',clock_timestamp());
BEGIN
  IF NEW."createdAt" > utc_now + interval '5 seconds'
     OR NEW."expiresAt" > utc_now + interval '10 minutes'
     OR (NEW."deliveredAt" IS NOT NULL AND NEW."deliveredAt" > utc_now + interval '5 seconds') THEN
    RAISE EXCEPTION 'OTP timestamp requires a current UTC clock' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "OtpToken_utc_clock_guard" BEFORE INSERT OR UPDATE ON "OtpToken" FOR EACH ROW EXECUTE FUNCTION guard_otp_utc_clock();

CREATE FUNCTION guard_otp_throttle_utc_clock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE utc_now TIMESTAMP := timezone('UTC',clock_timestamp());
BEGIN
  IF NEW."verificationWindowStart" > utc_now + interval '5 seconds'
     OR NEW."sendWindowStart" > utc_now + interval '5 seconds'
     OR (NEW."lastSentAt" IS NOT NULL AND NEW."lastSentAt" > utc_now + interval '5 seconds') THEN
    RAISE EXCEPTION 'OTP throttle timestamp requires a current UTC clock' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "OtpThrottle_utc_clock_guard" BEFORE INSERT OR UPDATE ON "OtpThrottle" FOR EACH ROW EXECUTE FUNCTION guard_otp_throttle_utc_clock();
COMMIT;
