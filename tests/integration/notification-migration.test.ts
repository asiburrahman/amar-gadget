import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createFinanceDatabase } from "@/tests/helpers/finance-database";
(process.env.TEST_DATABASE_URL ? describe : describe.skip)("notification migration preserves source history without invented deliveries", () => {
  it("keeps pre-existing events unbroadcast and captures only a subsequent real transition", async () => {
    const migration = "20261103120000_notification_outbox", fixture = await createFinanceDatabase(migration), db = fixture.db;
    try {
      const seller = await db.user.create({ data: { email: `${randomUUID()}@old-notification.example.invalid`, role: "MEMBER", sellerStatus: "APPROVED", isVerified: true } }), category = await db.category.create({ data: { name: randomUUID(), slug: randomUUID() } });
      const product = await db.product.create({ data: { name: "Actual old product", slug: randomUUID(), price: 100, stock: 2, sellerId: seller.id, categoryId: category.id, status: "PENDING_APPROVAL" } });
      const order = await db.order.create({ data: { userId: seller.id, total: 100, items: { create: [{ productId: product.id, quantity: 1, price: 100 }] } } });
      const before = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { events: true, items: true } });
      const { Client } = await import("pg"), connection = new Client({ connectionString: fixture.url }); await connection.connect();
      try { await connection.query(await readFile(join(process.cwd(), "prisma/migrations", migration, "migration.sql"), "utf8")); } finally { await connection.end(); }
      expect(await db.notificationEvent.count()).toBe(0); expect(await db.notification.count()).toBe(0); expect(await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { events: true, items: true } })).toEqual(before);
      await db.product.update({ where: { id: product.id }, data: { status: "APPROVED" } }); expect(await db.notificationEvent.findMany()).toEqual([expect.objectContaining({ kind: "PRODUCT_STATUS", audience: "SELLER", recipientId: seller.id, state: "READY" })]);
    } finally { await fixture.close(); }
  }, 30_000);
});
