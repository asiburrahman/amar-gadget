import type { PrismaClient, User } from "@prisma/client";
let mockDatabase: PrismaClient;
jest.mock("@/lib/prisma", () => ({ get prisma() { return mockDatabase; } }));
jest.mock("@/lib/session", () => ({ getCurrentUserWithRole: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: () => "127.0.0.1", rateLimit: jest.fn().mockResolvedValue({ success: true }) }));
import { PrismaClient as DatabaseClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { createFinanceDatabase } from "@/tests/helpers/finance-database";
import { listAdminSiteArticles, listPublicSiteArticles, mutateSiteContent, readAdminSiteContent, readAdminSiteContentRevision, readPublishedSiteContent } from "@/lib/site-content";
import { getCurrentUserWithRole } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";

const address = { kind: "PAGE" as const, slug: "about" };
const fields = { title: "Reviewed operator introduction", summary: "Information supplied and reviewed by the marketplace operator.", byline: "Operator", sections: [{ heading: "Marketplace information", body: "Contact the operator through the support form for order information." }] };
const draft = (version = 0, changes = {}) => ({ ...address, requestId: randomUUID(), version, action: "DRAFT", reason: "Save the reviewed document draft", fields, ...changes });
const publish = (version: number, changes = {}) => ({ ...address, requestId: randomUUID(), version, action: "PUBLISH", reason: "Publish the reviewed saved document", reviewed: true, ...changes });

(process.env.TEST_DATABASE_URL ? describe : describe.skip)("retained administrator publication and private drafts", () => {
  let fixture: Awaited<ReturnType<typeof createFinanceDatabase>>, admin: User, customer: User, timezoneClient: PrismaClient | undefined;
  beforeEach(async () => {
    jest.clearAllMocks(); (rateLimit as jest.Mock).mockResolvedValue({ success: true });
    fixture = await createFinanceDatabase(); mockDatabase = fixture.db;
    [admin, customer] = await Promise.all(["ADMIN", "USER"].map((role) => mockDatabase.user.create({ data: { email: `${randomUUID()}@content.example.invalid`, role, isVerified: true } })));
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(admin);
  }, 30_000);
  afterEach(async () => { await timezoneClient?.$disconnect(); timezoneClient = undefined; await fixture?.close(); });

  it("pages retained public article summaries independently of private drafts and withdrawn articles", async () => {
    expect(await listPublicSiteArticles()).toEqual({ page: 1, total: 0, totalPages: 1, rows: [] });
    for (let index = 0; index < 22; index++) {
      const target = { kind: "ARTICLE", slug: `article-${String(index).padStart(2, "0")}` };
      await mutateSiteContent(admin, draft(0, { ...target, fields: { ...fields, title: `Published article ${index}` } }));
      if (index < 21) await mutateSiteContent(admin, publish(1, target));
    }
    const first = await listPublicSiteArticles(), second = await listPublicSiteArticles(2);
    expect(first).toMatchObject({ page: 1, total: 21, totalPages: 2 }); expect(first.rows).toHaveLength(20); expect(second.rows).toHaveLength(1);
    expect(new Set([...first.rows, ...second.rows].map((row) => row.slug)).size).toBe(21);
    const issued = first.rows.find((row) => row.slug === "article-20")!;
    expect(issued).toMatchObject({ title: "Published article 20", version: 2, path: "/blog/article-20" });
    expect(issued.publishedAt).toBe((await readPublishedSiteContent({ kind: "ARTICLE", slug: issued.slug }))?.publishedAt);
    for (const key of ["draft", "sections", "reason", "actorId", "updatedAt"]) expect(issued).not.toHaveProperty(key);
    await mutateSiteContent(admin, draft(2, { kind: "ARTICLE", slug: issued.slug, fields: { ...fields, title: "Private replacement title" } }));
    expect((await listPublicSiteArticles()).rows.find((row) => row.slug === issued.slug)).toEqual(issued);
    const privateList = await listAdminSiteArticles(admin);
    expect(privateList.ownerId).toBe(admin.id); expect(privateList.articles.total).toBe(22);
    const edited = privateList.articles.rows.find((row) => row.slug === issued.slug)!;
    expect(edited).toMatchObject({ title: "Private replacement title", version: 3, publishedVersion: 2 });
    expect(edited).not.toHaveProperty("sections"); expect(edited).not.toHaveProperty("publishedAt");
    await mutateSiteContent(admin, { kind: "ARTICLE", slug: issued.slug, version: 3, requestId: randomUUID(), action: "UNPUBLISH", reason: "Withdraw article pending operator review" });
    expect((await listPublicSiteArticles()).total).toBe(20);
    expect((await listPublicSiteArticles()).rows.some((row) => row.slug === issued.slug)).toBe(false);
    await expect(listPublicSiteArticles(2)).rejects.toMatchObject({ status: 404 });
    await expect(listAdminSiteArticles(customer)).rejects.toMatchObject({ status: 403 });
    await expect(listAdminSiteArticles(admin, 3)).rejects.toMatchObject({ status: 404 });
  }, 30_000);

  it("wires the article collection API with strict pagination and account ownership", async () => {
    const { GET } = await import("@/app/api/admin/site-content/articles/route");
    const get = (query = "", owner = admin.id) => GET(new Request(`http://localhost/api/admin/site-content/articles${query}`, { headers: { "X-Site-Content-Owner": owner } }));
    const result = await get(); expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(await result.json()).toMatchObject({ success: true, ownerId: admin.id, articles: { total: 0, rows: [] } });
    expect((await get("?page=1&page=2")).status).toBe(400);
    expect((await get("?page=0")).status).toBe(400); expect((await get("?slug=about")).status).toBe(400);
    expect((await get("?page=2")).status).toBe(404); expect((await get("", customer.id)).status).toBe(409);
    await mockDatabase.user.update({ where: { id: admin.id }, data: { isVerified: false } });
    expect((await get()).status).toBe(403);
  });

  it("includes only retained publications in information and article sitemaps without leaking private edit times", async () => {
    const { sitemapFile, sitemapIndex } = await import("@/lib/seo/sitemaps");
    const initial = await sitemapFile("pages.xml");
    for (const path of ["/about", "/faq", "/privacy-policy", "/terms", "/returns", "/blog"]) expect(initial).not.toContain(`<loc>http://localhost${path}</loc>`);
    expect(await sitemapFile("articles-0.xml")).toBeNull();
    await mutateSiteContent(admin, draft());
    await mutateSiteContent(admin, draft(0, { kind: "ARTICLE", slug: "draft-only" }));
    expect(await sitemapFile("pages.xml")).toBe(initial);
    const issued = await mutateSiteContent(admin, publish(1));
    await mutateSiteContent(admin, draft(0, { kind: "ARTICLE", slug: "issued-article" }));
    const article = await mutateSiteContent(admin, publish(1, { kind: "ARTICLE", slug: "issued-article" }));
    const pages = await sitemapFile("pages.xml"), articles = await sitemapFile("articles-0.xml");
    expect(pages).toContain(`<loc>http://localhost/about</loc><lastmod>${issued.result.publishedAt}</lastmod>`);
    expect(pages).toContain("<loc>http://localhost/blog</loc>");
    expect(articles).toContain(`<loc>http://localhost/blog/issued-article</loc><lastmod>${article.result.publishedAt}</lastmod>`);
    expect(articles).not.toContain("draft-only"); expect(await sitemapIndex()).toContain("/sitemaps/articles-0.xml");
    await mutateSiteContent(admin, draft(2, { kind: "ARTICLE", slug: "issued-article", fields: { ...fields, title: "Private replacement" } }));
    expect(await sitemapFile("articles-0.xml")).toBe(articles);
    await mutateSiteContent(admin, { ...address, version: 2, requestId: randomUUID(), action: "UNPUBLISH", reason: "Withdraw information page for review" });
    expect(await sitemapFile("pages.xml")).not.toContain("<loc>http://localhost/about</loc>");
    expect(await sitemapFile("articles-1.xml")).toBeNull();
  });

  it("starts without sample content, keeps drafts private and preserves the issued snapshot across later edits", async () => {
    expect(await readPublishedSiteContent(address)).toBeNull();
    expect((await readAdminSiteContent(admin, address)).document).toBeNull();
    await mutateSiteContent(admin, draft()); expect(await readPublishedSiteContent(address)).toBeNull();
    await mutateSiteContent(admin, publish(1));
    const issued = await readPublishedSiteContent(address);
    expect(issued).toMatchObject({ ...fields, version: 2, path: "/about" });
    for (const key of ["draft", "actorId", "contentHash", "reason"]) expect(issued).not.toHaveProperty(key);
    await mutateSiteContent(admin, draft(2, { fields: { ...fields, title: "Private unpublished replacement" } }));
    expect(await readPublishedSiteContent(address)).toEqual(issued);
    const view = await readAdminSiteContent(admin, address);
    expect(view.document?.draft.title).toBe("Private unpublished replacement"); expect(view.publication).toEqual(issued);
    await mutateSiteContent(admin, { ...address, requestId: randomUUID(), version: 3, action: "UNPUBLISH", reason: "Withdraw the public document for review" });
    expect(await readPublishedSiteContent(address)).toBeNull();
    expect((await readAdminSiteContent(admin, address)).history.total).toBe(4);
    expect((await readAdminSiteContentRevision(admin, address, 2)).revision.after.draft).toEqual(fields);
    await mutateSiteContent(admin, publish(4));
    expect((await readPublishedSiteContent(address))?.title).toBe("Private unpublished replacement");
  });

  it("serializes initial editors, recovers original receipts and rejects conflicting references or stale decisions", async () => {
    const intent = draft(), results = await Promise.all([mutateSiteContent(admin, intent), mutateSiteContent(admin, intent)]);
    expect(results[0]).toEqual(results[1]); expect(await mockDatabase.siteContentRevision.count()).toBe(1);
    await expect(mutateSiteContent(admin, { ...intent, reason: "Conflicting reuse of the same reference" })).rejects.toMatchObject({ status: 409 });
    await expect(mutateSiteContent(admin, draft())).rejects.toMatchObject({ status: 409 });
    const rivals = await Promise.allSettled([
      mutateSiteContent(admin, draft(1, { fields: { ...fields, title: "First competing draft" } })),
      mutateSiteContent(admin, draft(1, { fields: { ...fields, title: "Second competing draft" } })),
    ]);
    expect(rivals.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await mockDatabase.siteContentRevision.count()).toBe(2);
    expect(await mutateSiteContent(admin, intent)).toEqual(results[0]);
    expect((await readAdminSiteContent(admin, address)).document?.version).toBe(2);
  });

  it("requires a complete saved draft and explicit review, without accepting unsaved publication fields", async () => {
    await mutateSiteContent(admin, draft(0, { fields: { title: "", summary: "", byline: "", sections: [] } }));
    await expect(mutateSiteContent(admin, publish(1))).rejects.toMatchObject({ status: 400 });
    await expect(mutateSiteContent(admin, publish(1, { reviewed: false }))).rejects.toThrow();
    await expect(mutateSiteContent(admin, publish(1, { fields }))).rejects.toThrow();
    expect(await mockDatabase.siteContentRevision.count()).toBe(1); expect(await readPublishedSiteContent(address)).toBeNull();
    await mutateSiteContent(admin, draft(1)); await mutateSiteContent(admin, publish(2));
    await expect(mutateSiteContent(admin, publish(3))).rejects.toMatchObject({ status: 409 });
    expect((await readPublishedSiteContent(address))?.version).toBe(3);
  });

  it("denies foreign roles and revoked sessions before returning drafts or retry receipts", async () => {
    const intent = draft(); await mutateSiteContent(admin, intent);
    await expect(readAdminSiteContent(customer, address)).rejects.toMatchObject({ status: 403 });
    await expect(readAdminSiteContentRevision(customer, address, 1)).rejects.toMatchObject({ status: 403 });
    await expect(mutateSiteContent(customer, draft(1))).rejects.toMatchObject({ status: 403 });
    await mockDatabase.user.update({ where: { id: admin.id }, data: { sessionVersion: { increment: 1 } } });
    await expect(readAdminSiteContent(admin, address)).rejects.toMatchObject({ status: 403 });
    await expect(mutateSiteContent(admin, intent)).rejects.toMatchObject({ status: 403 });
    expect(await mockDatabase.siteContentRevision.count()).toBe(1);
  });

  it("rechecks session authority after a real user-row lock wait", async () => {
    let acquired!: () => void, release!: () => void;
    const locked = new Promise<void>((done) => { acquired = done; }), gate = new Promise<void>((done) => { release = done; });
    const blocker = mockDatabase.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${admin.id} FOR UPDATE`;
      await tx.user.update({ where: { id: admin.id }, data: { sessionVersion: { increment: 1 } } });
      acquired(); await gate;
    }, { timeout: 10_000 });
    await locked;
    const waiting = mutateSiteContent(admin, draft()).then((result) => ({ ok: true, result }), (error: unknown) => ({ ok: false, error }));
    try {
      // Prove an actual database wait, not just that two promises overlapped.
      const deadline = Date.now() + 1500;
      let observed = false;
      while (Date.now() < deadline && !observed) {
        const [row] = await mockDatabase.$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT%"User"%'`;
        observed = Number(row.count) > 0;
        if (!observed) await new Promise((done) => setTimeout(done, 10));
      }
      expect(observed).toBe(true);
    } finally { release(); await blocker; }
    expect(await waiting).toMatchObject({ ok: false, error: { status: 403 } });
    expect(await mockDatabase.siteContent.count()).toBe(0);
  });

  it("enforces retained matching history, timestamps and rollback of orphan or forged publication evidence", async () => {
    await expect(mockDatabase.siteContent.create({ data: { ...address, version: 1, draft: fields } })).rejects.toThrow();
    await mutateSiteContent(admin, draft());
    const before = { ...address, version: 1, draft: fields, publishedVersion: null };
    const nextDraft = { ...before, version: 2, draft: { ...fields, title: "Orphan replacement" } };
    await expect(mockDatabase.siteContentRevision.create({ data: { ...address, version: 2, requestId: randomUUID(), contentHash: "a".repeat(64), actorId: admin.id, action: "DRAFT", reason: "Orphan history cannot commit", before, after: nextDraft } })).rejects.toThrow();
    await expect(mockDatabase.$transaction(async (tx) => {
      const after = { ...before, version: 2, publishedVersion: 2 };
      await tx.siteContentRevision.create({ data: { ...address, version: 2, requestId: randomUUID(), contentHash: "b".repeat(64), actorId: admin.id, action: "PUBLISH", reviewed: true, reason: "Reject a forged publication timestamp", before, after } });
      await tx.siteContent.update({ where: { kind_slug: address }, data: { version: 2, publishedVersion: 2, publishedAt: new Date(0) } });
    })).rejects.toThrow();
    expect(await mockDatabase.siteContentRevision.count()).toBe(1);
    await expect(mockDatabase.siteContent.deleteMany()).rejects.toThrow();
    await expect(mockDatabase.siteContentRevision.deleteMany()).rejects.toThrow();
    await expect(mockDatabase.siteContentRevision.updateMany({ data: { reason: "Attempted history rewrite" } })).rejects.toThrow();
    expect((await readAdminSiteContent(admin, address)).document?.version).toBe(1);
  });

  it("paginates retained decision history without sending old draft bodies in the list", async () => {
    for (let version = 0; version < 22; version++) await mutateSiteContent(admin, draft(version, { fields: { ...fields, title: `Reviewed draft number ${version + 1}` } }));
    const first = await readAdminSiteContent(admin, address), second = await readAdminSiteContent(admin, address, 2);
    expect(first.history).toMatchObject({ total: 22, totalPages: 2 }); expect(first.history.rows).toHaveLength(20);
    expect(second.history.rows.map((row) => row.version)).toEqual([2, 1]);
    for (const key of ["before", "after", "draft", "contentHash"]) expect(first.history.rows[0]).not.toHaveProperty(key);
    await expect(readAdminSiteContent(admin, address, 3)).rejects.toMatchObject({ status: 404 });
  });

  it.each(["UTC", "Asia/Dhaka", "America/New_York"])("records actual UTC publication under database session zone %s", async (zone) => {
    timezoneClient = new DatabaseClient({ adapter: new PrismaPg({ connectionString: fixture.url, max: 1, options: `-c timezone=${zone}` }), log: [] }); mockDatabase = timezoneClient;
    await mutateSiteContent(admin, draft()); const issued = await mutateSiteContent(admin, publish(1));
    const [clock] = await mockDatabase.$queryRaw<{ epoch: number }[]>`SELECT extract(epoch FROM clock_timestamp())::double precision AS epoch`;
    expect(Math.abs(Date.parse(issued.result.publishedAt!) - clock.epoch * 1000)).toBeLessThan(3000);
    expect((await readPublishedSiteContent(address))?.publishedAt).toBe(issued.result.publishedAt);
    const article = { kind: "ARTICLE", slug: "timezone-article" };
    const saved = await mutateSiteContent(admin, draft(0, article));
    expect((await listAdminSiteArticles(admin)).articles.rows[0].updatedAt).toBe(saved.result.updatedAt);
    const published = await mutateSiteContent(admin, publish(1, article));
    expect((await listPublicSiteArticles()).rows[0].publishedAt).toBe(published.result.publishedAt);
  });

  it("wires private GET/POST handlers with owner, revision, content type, body, query and rate boundaries", async () => {
    const route = await import("@/app/api/admin/site-content/route");
    const get = (query = "?kind=PAGE&slug=about", owner = admin.id) => new Request(`http://localhost/api/admin/site-content${query}`, { headers: { "X-Site-Content-Owner": owner } });
    const post = (body: string, type = "application/json", query = "") => new Request(`http://localhost/api/admin/site-content${query}`, { method: "POST", headers: { "X-Site-Content-Owner": admin.id, "Content-Type": type }, body });
    const initial = await route.GET(get()); expect(initial.status).toBe(200); expect(initial.headers.get("cache-control")).toBe("private, no-store");
    expect((await route.GET(get(undefined, customer.id))).status).toBe(409);
    expect((await route.GET(get("?kind=PAGE&slug=about&page=1&page=2"))).status).toBe(400);
    expect((await route.GET(get("?kind=PAGE&slug=admin"))).status).toBe(400);
    expect((await route.GET(get("?kind=PAGE&slug=about&revision=1&page=2"))).status).toBe(400);
    expect((await route.POST(post(JSON.stringify(draft()), "text/plain"))).status).toBe(415);
    expect((await route.POST(post("x".repeat(128 * 1024 + 1)))).status).toBe(413);
    expect((await route.POST(post(JSON.stringify(draft()), "application/json", "?extra=1"))).status).toBe(400);
    const intent = draft(), saved = await route.POST(post(JSON.stringify(intent))); expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ success: true, ownerId: admin.id, result: { version: 1, draft: fields, publishedVersion: null } });
    expect((await route.GET(get("?kind=PAGE&slug=about&revision=1"))).status).toBe(200);
    expect((await route.POST(post(JSON.stringify(publish(1))))).status).toBe(200);
    expect((await readPublishedSiteContent(address))?.title).toBe(fields.title);
    (rateLimit as jest.Mock).mockResolvedValueOnce({ success: false }); const limited = await route.GET(get()); expect(limited.status).toBe(429); expect(limited.headers.get("retry-after")).toBe("60");
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(customer); expect((await route.GET(get())).status).toBe(403);
    expect((await route.POST(post(JSON.stringify(draft(2))))).status).toBe(403);
  });

  it("reports an actual unavailable relation as a redacted retryable service failure, never a healthy empty draft", async () => {
    const route = await import("@/app/api/admin/site-content/route"), logged = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await mockDatabase.$executeRawUnsafe('ALTER TABLE "SiteContent" RENAME TO "AuditUnavailableSiteContent"');
    try {
      const response = await route.GET(new Request("http://localhost/api/admin/site-content?kind=PAGE&slug=about", { headers: { "X-Site-Content-Owner": admin.id } }));
      expect(response.status).toBe(503); const data = await response.json();
      expect(data).toMatchObject({ success: false, code: "SITE_CONTENT_UNAVAILABLE", reference: expect.any(String) });
      expect(data).not.toHaveProperty("document"); expect(JSON.stringify(data)).not.toContain("AuditUnavailableSiteContent");
      expect(logged).toHaveBeenCalledTimes(1); expect(String(logged.mock.calls[0][0])).not.toContain("AuditUnavailableSiteContent");
      await expect(readPublishedSiteContent(address)).rejects.toHaveProperty("name", "ServiceUnavailableError");
    } finally { await mockDatabase.$executeRawUnsafe('ALTER TABLE "AuditUnavailableSiteContent" RENAME TO "SiteContent"'); logged.mockRestore(); }
  });
});

(process.env.TEST_DATABASE_URL ? describe : describe.skip)("additive public content migration from version 36", () => {
  it("preserves existing accounts, catalog, purchases and events without inventing a public page or article", async () => {
    const migration = "20261105090000_site_content_publication", fixture = await createFinanceDatabase(migration); mockDatabase = fixture.db;
    try {
      const customer = await mockDatabase.user.create({ data: { email: `${randomUUID()}@content-upgrade.example.invalid`, password: "retained-private-hash", isVerified: true } });
      const seller = await mockDatabase.user.create({ data: { email: `${randomUUID()}@content-upgrade.example.invalid`, role: "MEMBER", isVerified: true } });
      const category = await mockDatabase.category.create({ data: { name: "Retained category", slug: randomUUID() } });
      const product = await mockDatabase.product.create({ data: { name: "Retained purchase product", slug: randomUUID(), sellerId: seller.id, categoryId: category.id, price: 100, stock: 5 } });
      const order = await mockDatabase.order.create({ data: { userId: customer.id, total: 100, items: { create: { productId: product.id, quantity: 1, price: 100 } } }, include: { items: true, fulfillments: true } });
      const before = { user: await mockDatabase.user.findUniqueOrThrow({ where: { id: customer.id } }), product: await mockDatabase.product.findUniqueOrThrow({ where: { id: product.id } }), events: await mockDatabase.orderEvent.findMany({ where: { orderId: order.id } }) };
      const connection = new Client({ connectionString: fixture.url }); await connection.connect();
      try { await connection.query(await readFile(join(process.cwd(), "prisma/migrations", migration, "migration.sql"), "utf8")); } finally { await connection.end(); }
      expect(await mockDatabase.user.findUniqueOrThrow({ where: { id: customer.id } })).toEqual(before.user);
      expect(await mockDatabase.product.findUniqueOrThrow({ where: { id: product.id } })).toEqual(before.product);
      expect(await mockDatabase.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true, fulfillments: true } })).toEqual(order);
      expect(await mockDatabase.orderEvent.findMany({ where: { orderId: order.id } })).toEqual(before.events);
      expect(await mockDatabase.siteContent.count()).toBe(0); expect(await mockDatabase.siteContentRevision.count()).toBe(0);
    } finally { await fixture.close(); }
  }, 30_000);
});
