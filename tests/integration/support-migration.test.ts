import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { createFinanceDatabase } from "@/tests/helpers/finance-database";

(process.env.TEST_DATABASE_URL ? describe : describe.skip)("support migration from the existing notification schema", () => {
  it("preserves existing accounts/catalog/outbox evidence without inventing historic inquiries", async () => {
    const fixture = await createFinanceDatabase("20261103140000_support_messages");
    try {
      const seller = await fixture.db.user.create({ data: { email: `${randomUUID()}@upgrade.example.invalid`, role: "MEMBER", isVerified: true, sellerStatus: "APPROVED" } });
      const category = await fixture.db.category.create({ data: { name: "Existing upgrade category", slug: randomUUID() } });
      const created = await fixture.db.product.create({ data: { name: "Existing upgrade product", slug: randomUUID(), price: 100, stock: 3, sellerId: seller.id, categoryId: category.id, status: "PENDING" } });
      const product = await fixture.db.product.update({ where: { id: created.id }, data: { status: "REJECTED" } });
      const beforeEvents = await fixture.db.notificationEvent.findMany({ orderBy: { id: "asc" } });
      expect(beforeEvents.length).toBeGreaterThan(0);
      const connection = new Client({ connectionString: fixture.url }); await connection.connect();
      try { await connection.query(await readFile(join(process.cwd(), "prisma/migrations/20261103140000_support_messages/migration.sql"), "utf8")); }
      finally { await connection.end(); }
      expect(await fixture.db.user.findUnique({ where: { id: seller.id } })).toEqual(seller);
      expect(await fixture.db.product.findUnique({ where: { id: product.id } })).toEqual(product);
      expect(await fixture.db.notificationEvent.findMany({ orderBy: { id: "asc" } })).toEqual(beforeEvents);
      expect(await fixture.db.supportMessage.count()).toBe(0); expect(await fixture.db.supportMessageEvent.count()).toBe(0); expect(await fixture.db.supportRequest.count()).toBe(0);
    } finally { await fixture.close(); }
  }, 30_000);
  it("adds an empty dynamic-contact configuration without altering existing support messages", async () => {
    const fixture = await createFinanceDatabase("20261103150000_support_contact_settings");
    try {
      const message = await fixture.db.supportMessage.create({ data: { id: randomUUID(), contentHash: "a".repeat(64), name: "Existing sender", email: "sender@example.invalid", topic: "OTHER", subject: "Existing support inquiry", message: "Preserve the original inquiry during upgrade." } });
      const connection = new Client({ connectionString: fixture.url }); await connection.connect();
      try { await connection.query(await readFile(join(process.cwd(), "prisma/migrations/20261103150000_support_contact_settings/migration.sql"), "utf8")); }
      finally { await connection.end(); }
      expect(await fixture.db.supportMessage.findUnique({ where: { id: message.id } })).toEqual(message);
      expect(await fixture.db.supportContactSettings.count()).toBe(0); expect(await fixture.db.supportContactEvent.count()).toBe(0);
    } finally { await fixture.close(); }
  }, 30_000);
});
