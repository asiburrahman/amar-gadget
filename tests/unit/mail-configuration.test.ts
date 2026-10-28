jest.mock("nodemailer", () => ({ createTransport: jest.fn() }));
jest.mock("@/lib/prisma", () => ({ prisma: { otpToken: { deleteMany: jest.fn(), create: jest.fn() } } }));
import nodemailer from "nodemailer";
import { getMailTransport, MailConfigurationError } from "../../lib/mail/nodemailer";
import { sendOtpEmail } from "../../lib/mail/send-otp";
import { prisma } from "@/lib/prisma";

const original = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  for (const name of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"]) delete process.env[name];
});
afterAll(() => { process.env = original; });
const configure = () => Object.assign(process.env, { SMTP_HOST: "smtp.example.invalid", SMTP_USER: "mail-test@example.invalid", SMTP_PASS: "unit-test-only-private-value", SMTP_FROM: "Store <mail-test@example.invalid>" });

it("fails closed without private SMTP settings and never substitutes checked-in credentials", () => {
  expect(() => getMailTransport()).toThrow(MailConfigurationError);
  expect(nodemailer.createTransport).not.toHaveBeenCalled();
});

it.each([["465", true], ["587", false]])("uses configured TLS transport on port %s", (port, secure) => {
  configure(); process.env.SMTP_PORT = port;
  getMailTransport();
  expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: "smtp.example.invalid", port: Number(port), secure, requireTLS: !secure, auth: { user: "mail-test@example.invalid", pass: "unit-test-only-private-value" } }));
});

it.each(["0", "65536", "not-a-port"])("rejects invalid SMTP port %s before network work", (port) => {
  configure(); process.env.SMTP_PORT = port;
  expect(() => getMailTransport()).toThrow(MailConfigurationError);
  expect(nodemailer.createTransport).not.toHaveBeenCalled();
});

it("rejects missing sender before creating an undeliverable OTP and exposes no provider details", async () => {
  configure(); delete process.env.SMTP_FROM;
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    expect(await sendOtpEmail("buyer@example.invalid")).toEqual({ success: false, error: "Email delivery is temporarily unavailable. Please retry shortly." });
    expect(prisma.otpToken.create).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("unit-test-only-private-value");
  } finally { log.mockRestore(); }
});

it("sends through the explicitly configured sender without returning a code", async () => {
  configure();
  const sendMail = jest.fn().mockResolvedValue({ accepted: ["buyer@example.invalid"] });
  (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
  expect(await sendOtpEmail("buyer@example.invalid")).toEqual({ success: true });
  expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: "Store <mail-test@example.invalid>", to: "buyer@example.invalid" }));
});

it("invalidates an undelivered code and hides provider credential/error details", async () => {
  configure();
  (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail: jest.fn().mockRejectedValue(new Error("Sensitive provider details: unit-test-only-private-value")) });
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    expect(await sendOtpEmail("buyer@example.invalid")).toEqual({ success: false, error: "Email delivery is temporarily unavailable. Please retry shortly." });
    expect(prisma.otpToken.deleteMany).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(log.mock.calls)).not.toContain("Sensitive provider details");
    expect(JSON.stringify(log.mock.calls)).not.toContain("unit-test-only-private-value");
  } finally { log.mockRestore(); }
});
