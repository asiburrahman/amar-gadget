const mockSendMail = jest.fn(), mockClose = jest.fn();
jest.mock("@/lib/mail/nodemailer", () => ({ getMailTransport: jest.fn(() => ({ sendMail: mockSendMail, close: mockClose })) }));
import { getMailTransport } from "@/lib/mail/nodemailer";
import { sendNewsletterConfirmation } from "@/lib/mail/send-newsletter-confirmation";
const original = { APP_URL: process.env.APP_URL, SMTP_FROM: process.env.SMTP_FROM, OTP_SECRET: process.env.OTP_SECRET };
const subject = { id: "fb13b340-261c-4b42-a3b8-f50a6009f0ee", generation: 1, confirmationNonce: "confirm-nonce", confirmationExpiresAt: new Date("2026-11-04T10:00:00Z"), unsubscribeNonce: "stop-nonce" };
beforeEach(() => { jest.clearAllMocks(); process.env.APP_URL = "https://shop.example.invalid"; process.env.SMTP_FROM = "Local test <newsletter@example.invalid>"; process.env.OTP_SECRET = "newsletter-mail-test-signing-key-thirty-two-bytes"; mockSendMail.mockResolvedValue({ accepted: ["customer@example.invalid"] }); });
afterAll(() => { for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
it("builds the configured transport payload with stable identity and separate explicit email actions", async () => {
  await sendNewsletterConfirmation(" Customer@Example.Invalid ", subject, subject.id);
  expect(getMailTransport).toHaveBeenCalledTimes(1); const sent = mockSendMail.mock.calls[0][0];
  expect(sent).toMatchObject({ from: "Local test <newsletter@example.invalid>", to: "customer@example.invalid", messageId: `<newsletter-${subject.id}@shop.example.invalid>` });
  expect(sent.text).toContain("/newsletter/confirm#token="); expect(sent.text).toContain("/newsletter/unsubscribe#token="); expect(sent.text).toContain(subject.confirmationExpiresAt.toISOString()); expect(sent.text).toContain("not subscribed until you confirm"); expect(sent.text).not.toContain("$20"); expect(sent).not.toHaveProperty("html"); expect(mockClose).toHaveBeenCalledTimes(1);
});
it("does not report success when the provider rejects this recipient and closes failed transports", async () => {
  mockSendMail.mockResolvedValueOnce({ accepted: [], rejected: ["customer@example.invalid"] }); await expect(sendNewsletterConfirmation("customer@example.invalid", subject, subject.id)).rejects.toMatchObject({ code: "NEWSLETTER_DELIVERY_REJECTED", status: 503 }); expect(mockClose).toHaveBeenCalledTimes(1);
  mockSendMail.mockRejectedValueOnce(new Error("Controlled provider failure")); await expect(sendNewsletterConfirmation("customer@example.invalid", subject, subject.id)).rejects.toThrow("Controlled provider failure"); expect(mockClose).toHaveBeenCalledTimes(2);
});
it("rejects malformed sender input or missing configuration before making a provider request", async () => {
  await expect(sendNewsletterConfirmation("customer@example.invalid\r\nBcc:foreign@example.invalid", subject, subject.id)).rejects.toThrow();
  await expect(sendNewsletterConfirmation("customer@example.invalid", subject, "forged\r\nheader")).rejects.toThrow();
  delete process.env.SMTP_FROM; await expect(sendNewsletterConfirmation("customer@example.invalid", subject, subject.id)).rejects.toThrow(); expect(mockSendMail).not.toHaveBeenCalled();
});
it("sends an active recipient a current unsubscribe capability without claiming a new confirmation", async () => {
  await sendNewsletterConfirmation("customer@example.invalid", subject, subject.id, true);
  const sent = mockSendMail.mock.calls[0][0]; expect(sent.subject).toContain("manage your newsletter preference"); expect(sent.text).toContain("/newsletter/unsubscribe#token="); expect(sent.text).not.toContain("/newsletter/confirm"); expect(sent.text).toContain("does not change your preference"); expect(mockClose).toHaveBeenCalledTimes(1);
});
