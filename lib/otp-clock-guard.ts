import { Prisma } from "@prisma/client";
/** A newer UTC reader must fail closed against an older database, before it
 * can reinterpret that database's future-dated legacy credentials. */
export const otpClockGuard = Prisma.sql`(
  EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('"OtpToken"') AND tgname='OtpToken_utc_clock_guard' AND tgenabled IN ('O','A') AND NOT tgisinternal)
  AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('"OtpThrottle"') AND tgname='OtpThrottle_utc_clock_guard' AND tgenabled IN ('O','A') AND NOT tgisinternal)
)`;
