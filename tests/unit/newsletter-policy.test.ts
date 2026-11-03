import { newsletterMailLinks, newsletterRequestHash, newsletterToken, validNewsletterToken } from "@/lib/newsletter-policy";
import { newsletterSubscribeSchema, newsletterTokenMutationSchema } from "@/lib/validations/newsletter";
const originalSecret = process.env.OTP_SECRET;
const subject = { id: "fb13b340-261c-4b42-a3b8-f50a6009f0ee", generation: 1, confirmationNonce: "random-confirmation-nonce", confirmationExpiresAt: new Date("2026-11-04T10:00:00Z"), unsubscribeNonce: "random-unsubscribe-nonce" };
const now = new Date("2026-11-03T10:00:00Z");
beforeEach(() => { process.env.OTP_SECRET = "newsletter-test-key-with-at-least-thirty-two-bytes"; });
afterAll(() => { if (originalSecret === undefined) delete process.env.OTP_SECRET; else process.env.OTP_SECRET = originalSecret; });
it("normalizes bounded explicit consent and rejects forged subscription authority or header injection", () => {
  const input = { requestId: subject.id, email: " Customer@Example.Invalid ", consent: true };
  const parsed = newsletterSubscribeSchema.parse(input); expect(parsed.email).toBe("customer@example.invalid"); expect(newsletterRequestHash(parsed)).toMatch(/^[a-f0-9]{64}$/);
  for (const change of [{ consent: false }, { status: "ACTIVE" }, { email: "person@example.invalid\r\nBcc:other@example.invalid" }, { requestId: "guessable" }, { email: "x".repeat(255) }]) expect(newsletterSubscribeSchema.safeParse({ ...input, ...change }).success).toBe(false);
});
it("binds confirmation to its subscriber, generation, nonce, expiry and purpose", () => {
  const token = newsletterToken(subject, "CONFIRM"); expect(newsletterTokenMutationSchema.safeParse({ token }).success).toBe(true); expect(validNewsletterToken(subject, "CONFIRM", token, now)).toBe(true);
  for (const changed of [{ ...subject, generation: 2 }, { ...subject, id: "fb13b340-261c-4b42-a3b8-f50a6009f0ef" }, { ...subject, confirmationNonce: "replaced-nonce" }, { ...subject, confirmationExpiresAt: new Date("2026-11-04T11:00:00Z") }]) expect(validNewsletterToken(changed, "CONFIRM", token, now)).toBe(false);
  expect(validNewsletterToken(subject, "UNSUBSCRIBE", token, now)).toBe(false);
  expect(validNewsletterToken(subject, "CONFIRM", token, subject.confirmationExpiresAt)).toBe(false);
  expect(validNewsletterToken(subject, "CONFIRM", token, new Date(subject.confirmationExpiresAt.getTime() - 1))).toBe(true);
});
it("keeps the unsubscribe capability usable after later requests without making it a confirmation capability", () => {
  const token = newsletterToken(subject, "UNSUBSCRIBE"), later = { ...subject, generation: 5, confirmationNonce: "later-request-nonce", confirmationExpiresAt: new Date("2026-11-01T10:00:00Z") };
  expect(validNewsletterToken(later, "UNSUBSCRIBE", token, now)).toBe(true); expect(validNewsletterToken(later, "CONFIRM", token, now)).toBe(false);
  expect(validNewsletterToken({ ...later, unsubscribeNonce: "rotated" }, "UNSUBSCRIBE", token, now)).toBe(false);
});
it("rejects tampering, malformed capability lengths and key rotation without logging secret material", () => {
  const token = newsletterToken(subject, "CONFIRM");
  for (const malformed of ["", "short", `${subject.id}.wrong`, `${token.slice(0, -1)}!`, `${token}.extra`]) expect(validNewsletterToken(subject, "CONFIRM", malformed, now)).toBe(false);
  const final = token.at(-1)!; expect(validNewsletterToken(subject, "CONFIRM", token.slice(0, -1) + (final === "A" ? "B" : "A"), now)).toBe(false);
  process.env.OTP_SECRET = "a-different-newsletter-test-signing-key-long-enough"; expect(validNewsletterToken(subject, "CONFIRM", token, now)).toBe(false);
  delete process.env.OTP_SECRET; expect(() => newsletterToken(subject, "CONFIRM")).toThrow("temporarily unavailable");
});
it("uses only canonical application links and fragments, avoiding server query/referrer token exposure", () => {
  const links = newsletterMailLinks(subject, "https://shop.example.invalid");
  for (const [purpose, link] of [["CONFIRM", links.confirmation], ["UNSUBSCRIBE", links.unsubscribe]] as const) { const url = new URL(link); expect(url.search).toBe(""); expect(url.origin).toBe("https://shop.example.invalid"); expect(validNewsletterToken(subject, purpose, new URLSearchParams(url.hash.slice(1)).get("token")!, now)).toBe(true); }
  for (const origin of ["http://foreign.example.invalid", "https://user:pass@shop.example.invalid", "https://shop.example.invalid/foreign", "https://shop.example.invalid?tracking=1", "https://shop.example.invalid#secret", "javascript:alert(1)"]) expect(() => newsletterMailLinks(subject, origin)).toThrow();
});
