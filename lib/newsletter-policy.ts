import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readPrivateSecret } from "@/config/runtime";
import { newsletterTokenSchema, NEWSLETTER_CONSENT_VERSION, type NewsletterSubscribe } from "@/lib/validations/newsletter";

export const NEWSLETTER_CONFIRMATION_MS = 24 * 60 * 60_000;
export const NEWSLETTER_RESEND_MS = 60_000;
export const NEWSLETTER_LEASE_MS = 90_000;
export class NewsletterError extends Error {
  constructor(message: string, readonly status = 409, readonly code = "NEWSLETTER_CONFLICT", readonly retryAfter?: number) { super(message); }
}
export type NewsletterTokenSubject = {
  id: string; generation: number; confirmationNonce: string;
  confirmationExpiresAt: Date; unsubscribeNonce: string;
};
export type NewsletterTokenPurpose = "CONFIRM" | "UNSUBSCRIBE";
function signature(subject: NewsletterTokenSubject, purpose: NewsletterTokenPurpose) {
  let secret: string;
  try { secret = readPrivateSecret("OTP_SECRET"); }
  catch { throw new NewsletterError("Newsletter verification is temporarily unavailable.", 503, "NEWSLETTER_UNAVAILABLE"); }
  const context = purpose === "CONFIRM"
    ? [subject.confirmationNonce, subject.generation, subject.confirmationExpiresAt.toISOString()]
    : [subject.unsubscribeNonce];
  return createHmac("sha256", secret).update(JSON.stringify(["amar-newsletter-token-v1", purpose, subject.id, ...context])).digest("base64url");
}
export function newsletterToken(subject: NewsletterTokenSubject, purpose: NewsletterTokenPurpose) {
  return `${subject.id}.${signature(subject, purpose)}`;
}
export function validNewsletterToken(subject: NewsletterTokenSubject, purpose: NewsletterTokenPurpose, token: string, now: Date) {
  if (!newsletterTokenSchema.safeParse(token).success) return false;
  const [id, supplied] = token.split(".");
  if (id !== subject.id) return false;
  const expected = signature(subject, purpose);
  const matches = timingSafeEqual(Buffer.from(supplied, "ascii"), Buffer.from(expected, "ascii"));
  return matches && (purpose === "UNSUBSCRIBE" || now.getTime() < subject.confirmationExpiresAt.getTime());
}
export function newsletterRequestHash(input: NewsletterSubscribe) {
  return createHash("sha256").update(JSON.stringify(["newsletter-request-v1", input.email, input.consent, NEWSLETTER_CONSENT_VERSION])).digest("hex");
}
export function newsletterMailLinks(subject: NewsletterTokenSubject, origin: string) {
  const url = new URL(origin);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || !(url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new NewsletterError("Newsletter delivery is temporarily unavailable.", 503, "NEWSLETTER_UNAVAILABLE");
  return {
    confirmation: `${url.origin}/newsletter/confirm#token=${encodeURIComponent(newsletterToken(subject, "CONFIRM"))}`,
    unsubscribe: `${url.origin}/newsletter/unsubscribe#token=${encodeURIComponent(newsletterToken(subject, "UNSUBSCRIBE"))}`,
  };
}
