import type { PrismaClient } from "@prisma/client";
let mockDatabase: PrismaClient;
jest.mock("@/lib/prisma", () => ({ get prisma() { return mockDatabase; } }));
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { createFinanceDatabase } from "@/tests/helpers/finance-database";
import { submitSupportMessage } from "@/lib/support";
import { saveSupportContactSettings } from "@/lib/support-contact";

(process.env.TEST_DATABASE_URL ? describe : describe.skip)("newsletter consent upgrade from migration 34", () => {
  it("preserves verified accounts, support consent and published contact history without enrolling any of them", async () => {
    const fixture = await createFinanceDatabase("20261103160000_newsletter_consent"); mockDatabase = fixture.db;
    try {
      const admin = await mockDatabase.user.create({ data: { email: `${randomUUID()}@newsletter-upgrade.example.invalid`, role: "ADMIN", isVerified: true } });
      await submitSupportMessage({ requestId: randomUUID(), name: "Existing support sender", email: "sender@example.invalid", topic: "OTHER", subject: "Existing inquiry", message: "Support consent must not become newsletter consent.", consent: true });
      await saveSupportContactSettings(admin, { requestId: randomUUID(), version: 0, fields: { email: "operator@example.invalid", phone: null, address: "Existing public office", hours: null, published: true }, verified: true, reason: "Existing reviewed business contact details" });
      const before = { user: await mockDatabase.user.findUniqueOrThrow({ where: { id: admin.id } }), messages: await mockDatabase.supportMessage.findMany(), settings: await mockDatabase.supportContactSettings.findMany(), events: await mockDatabase.supportContactEvent.findMany() };
      const connection = new Client({ connectionString: fixture.url }); await connection.connect();
      try { await connection.query(await readFile(join(process.cwd(), "prisma/migrations/20261103160000_newsletter_consent/migration.sql"), "utf8")); } finally { await connection.end(); }
      expect(await mockDatabase.user.findUniqueOrThrow({ where: { id: admin.id } })).toEqual(before.user); expect(await mockDatabase.supportMessage.findMany()).toEqual(before.messages); expect(await mockDatabase.supportContactSettings.findMany()).toEqual(before.settings); expect(await mockDatabase.supportContactEvent.findMany()).toEqual(before.events);
      expect(await mockDatabase.newsletterSubscriber.count()).toBe(0); expect(await mockDatabase.newsletterEvent.count()).toBe(0); expect(await mockDatabase.newsletterRequest.count()).toBe(0);
    } finally { await fixture.close(); }
  }, 30_000);
});
