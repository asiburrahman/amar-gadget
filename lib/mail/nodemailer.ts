import nodemailer from "nodemailer";

export class MailConfigurationError extends Error {
  constructor() { super("Email delivery is not configured."); }
}

export function getMailTransport() {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  const port = Number(process.env.SMTP_PORT || "587");
  if (!host || !user || !pass || !Number.isInteger(port) || port < 1 || port > 65535) throw new MailConfigurationError();
  return nodemailer.createTransport({
    host, port, secure: port === 465, requireTLS: port !== 465,
    auth: { user, pass },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
  });
}
