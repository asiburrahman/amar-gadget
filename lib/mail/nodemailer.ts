import nodemailer from "nodemailer";
import { readMailTransportConfig } from "@/config/runtime";

export class MailConfigurationError extends Error {
  constructor() { super("Email delivery is not configured."); }
}

export function getMailTransport() {
  let config: ReturnType<typeof readMailTransportConfig>;
  try { config = readMailTransportConfig(); } catch { throw new MailConfigurationError(); }
  const { SMTP_HOST: host, SMTP_USER: user, SMTP_PASS: pass, SMTP_PORT: port } = config;
  return nodemailer.createTransport({
    host, port, secure: port === 465, requireTLS: port !== 465,
    auth: { user, pass },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
  });
}
