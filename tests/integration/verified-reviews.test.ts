jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: () => "127.0.0.1", rateLimit: jest.fn().mockResolvedValue({ success: true }) }));
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { PrismaClient, User, Product, Category } from "@prisma/client";
import { getCurrentUser } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import { revalidatePath } from "next/cache";
import * as own from "@/app/api/user/reviews/route";
import * as adminApi from "@/app/api/admin/reviews/route";
import { GET as publicApi } from "@/app/api/reviews/route";
import { GET as sellerApi } from "@/app/api/member/reviews/route";
import { getPublicProduct } from "@/lib/public-product";
import { createVerifiedReview, editVerifiedReview, moderateVerifiedReview, reconcileProductReviews } from "@/lib/reviews";
import type { OwnedReview } from "@/lib/validations/review";

(process.env.TEST_DATABASE_URL ? describe : describe.skip)("verified purchase review handlers with actual PostgreSQL", () => {
  let db: PrismaClient, buyer: User, other: User, seller: User, secondSeller: User, admin: User, category: Category, product: Product, secondProduct: Product;
  let buyerItem: string, otherItem: string;
  const prefix = `audit-review-${randomUUID()}`;
  const request = (path: string, method = "GET", body?: unknown, actor = buyer) => new Request(`http://localhost${path}`, { method, headers: { "X-Review-Owner": actor.id }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const actAs = (actor: User | null) => (getCurrentUser as jest.Mock).mockResolvedValue(actor);
  const publish = async (review: OwnedReview) => { actAs(admin); const response = await adminApi.POST(request("/api/admin/reviews", "POST", { id: review.id, version: review.version, action: "publish" }, admin)); expect(response.status).toBe(200); return (await response.json()).review as OwnedReview; };
  const submit = async (rating = 4, comment = "Actual purchased product feedback") => {
    actAs(buyer); const response = await own.POST(request("/api/user/reviews", "POST", { productId: product.id, rating, comment })); expect(response.status).toBe(201); return (await response.json()).review as OwnedReview;
  };
  const publicRead = (page = 1) => publicApi(request(`/api/reviews?productId=${product.id}&page=${page}`));
  const purchase = async (userId: string, productId: string) => db.order.create({ data: { userId, total: 100, status: "DELIVERED", paymentStatus: "PAID", paymentMethod: "COD", items: { create: { productId, quantity: 1, price: 100 } } }, include: { items: true } });
  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma;
    [buyer, other, seller, secondSeller, admin] = await Promise.all(["buyer", "other", "seller", "second-seller", "admin"].map((name) => db.user.create({ data: { email: `${prefix}-${name}@example.invalid`, name: `${name} Private-family-name`, isVerified: true, role: name === "admin" ? "ADMIN" : name.includes("seller") ? "MEMBER" : "USER", sellerStatus: "APPROVED" } })));
    category = await db.category.create({ data: { name: prefix, slug: prefix } });
    product = await db.product.create({ data: { name: `${prefix}-product`, slug: `${prefix}-product`, price: 100, stock: 10, sellerId: seller.id, categoryId: category.id, status: "APPROVED" } });
    secondProduct = await db.product.create({ data: { name: `${prefix}-other-product`, slug: `${prefix}-other-product`, price: 100, stock: 10, sellerId: secondSeller.id, categoryId: category.id, status: "APPROVED" } });
    buyerItem = (await purchase(buyer.id, product.id)).items[0].id; otherItem = (await purchase(other.id, product.id)).items[0].id;
  });
  beforeEach(async () => {
    await db.review.deleteMany({ where: { product: { categoryId: category.id } } });
    await db.product.updateMany({ where: { categoryId: category.id }, data: { status: "APPROVED", rating: 0, reviewCount: 0, reviewVersion: 0 } });
    await db.order.updateMany({ where: { items: { some: { product: { categoryId: category.id } } } }, data: { status: "DELIVERED", paymentStatus: "PAID" } });
    await db.user.updateMany({ where: { id: { in: [seller.id, secondSeller.id] } }, data: { sellerStatus: "APPROVED", isVerified: true } });
    await db.user.update({ where: { id: admin.id }, data: { role: "ADMIN", isVerified: true } });
    [buyer, seller, secondSeller, admin] = await Promise.all([buyer, seller, secondSeller, admin].map((actor) => db.user.findUniqueOrThrow({ where: { id: actor.id } })));
    actAs(buyer); (rateLimit as jest.Mock).mockResolvedValue({ success: true }); (revalidatePath as jest.Mock).mockReset();
  });
  afterAll(async () => { if (db) try {
    if (category) {
      await db.review.deleteMany({ where: { product: { categoryId: category.id } } });
      await db.orderItem.deleteMany({ where: { product: { categoryId: category.id } } });
      await db.order.deleteMany({ where: { user: { email: { startsWith: prefix } } } });
      await db.product.deleteMany({ where: { categoryId: category.id } }); await db.category.delete({ where: { id: category.id } });
    }
    await db.user.deleteMany({ where: { email: { startsWith: prefix } } });
  } finally { await db.$disconnect(); } });

  it("derives delivered/paid eligibility from the current buyer and never accepts caller ownership or a chosen order item", async () => {
    const access = await own.GET(request(`/api/user/reviews?productId=${product.id}`)); expect(access.status).toBe(200); expect(await access.json()).toMatchObject({ ownerId: buyer.id, eligible: true, review: null });
    const eligible = await own.GET(request("/api/user/reviews?tab=eligible")); expect((await eligible.json()).products.map((row: { id: string }) => row.id)).toEqual([product.id]);
    for (const extra of [{ userId: other.id }, { orderItemId: otherItem }, { status: "PUBLISHED" }, { isCanonical: false }]) expect((await own.POST(request("/api/user/reviews", "POST", { productId: product.id, rating: 5, comment: null, ...extra }))).status).toBe(400);
    const orderId = (await db.orderItem.findUniqueOrThrow({ where: { id: buyerItem } })).orderId;
    for (const state of [{ status: "PROCESSING", paymentStatus: "PAID" }, { status: "DELIVERED", paymentStatus: "UNPAID" }, { status: "CANCELLED", paymentStatus: "PAID" }]) {
      await db.order.update({ where: { id: orderId }, data: state }); const result = await own.POST(request("/api/user/reviews", "POST", { productId: product.id, rating: 5, comment: null })); expect(result.status).toBe(403); expect((await result.json()).code).toBe("REVIEW_INELIGIBLE");
    }
  });
  it("stores pending feedback privately and publishes actual text/rating only after authorized moderation", async () => {
    const review = await submit(4, '<script>this is text</script> ভালো পণ্য'); expect(review).toMatchObject({ status: "PENDING", version: 1, isCanonical: true });
    expect((await db.review.findUniqueOrThrow({ where: { id: review.id } })).orderItemId).toBe(buyerItem);
    expect((await (await publicRead()).json()).total).toBe(0);
    actAs(seller); expect((await (await sellerApi(request("/api/member/reviews", "GET", undefined, seller))).json()).total).toBe(0);
    const approved = await publish(review); expect(approved.status).toBe("PUBLISHED");
    const response = await publicRead(), body = await response.json(); expect(body).toMatchObject({ total: 1, rating: 4, version: 1, reviews: [{ id: review.id, rating: 4, comment: '<script>this is text</script> ভালো পণ্য', displayName: "buyer", verifiedPurchase: true }] });
    const serialized = JSON.stringify(body); for (const forbidden of [buyer.email, buyer.id, buyerItem, "Private-family-name", "moderatedById", "moderationReason", "avatar"]) expect(serialized).not.toContain(forbidden);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ rating: 4, reviewCount: 1, reviewVersion: 1 });
    const actualProduct = await getPublicProduct(product.slug); expect(actualProduct?.reviews[0]).toMatchObject({ rating: 4, verifiedPurchase: true, user: { name: "buyer" } });
    expect(JSON.stringify(actualProduct?.reviews)).not.toContain("moderatedById");
  });
  it("returns edited published reviews to pending, removes their aggregate contribution and rejects stale moderation", async () => {
    const original = await publish(await submit()); actAs(buyer);
    const response = await own.PUT(request("/api/user/reviews", "PUT", { id: original.id, version: original.version, rating: 2, comment: "Updated actual product experience" })); expect(response.status).toBe(200); const edited = (await response.json()).review;
    expect(edited.status).toBe("PENDING"); expect((await (await publicRead()).json()).total).toBe(0);
    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ rating: 0, reviewCount: 0, reviewVersion: 2 });
    actAs(admin); expect((await adminApi.POST(request("/api/admin/reviews", "POST", { id: original.id, version: original.version, action: "publish" }, admin))).status).toBe(409);
    await publish(edited); expect((await (await publicRead()).json()).rating).toBe(2);
  });
  it("serializes concurrent one-per-product submissions and records real averages from independent buyers", async () => {
    const responses = await Promise.all([own.POST(request("/api/user/reviews", "POST", { productId: product.id, rating: 5, comment: null })), own.POST(request("/api/user/reviews", "POST", { productId: product.id, rating: 3, comment: null }))]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]); expect(await db.review.count({ where: { productId: product.id, userId: buyer.id, isCanonical: true } })).toBe(1);
    const first = await db.review.findFirstOrThrow({ where: { productId: product.id, userId: buyer.id } });
    const second = await createVerifiedReview(other, { productId: product.id, rating: 1, comment: "Other buyer's purchase" });
    await Promise.all([moderateVerifiedReview(admin, { id: first.id, version: first.version, action: "publish" }), moderateVerifiedReview(admin, { id: second.id, version: second.version, action: "publish" })]);
    const aggregate = await db.product.findUniqueOrThrow({ where: { id: product.id } }); expect(aggregate.reviewCount).toBe(2); expect(aggregate.rating).toBe((first.rating + 1) / 2);
    expect((await (await publicRead()).json()).rating).toBe(aggregate.rating);
  });
  it("guards owners, queued account headers, seller scope and blocked/revoked permissions", async () => {
    const review = await publish(await submit()); actAs(other);
    expect((await own.PUT(request("/api/user/reviews", "PUT", { id: review.id, version: review.version, rating: 1, comment: "Foreign edit" }, other))).status).toBe(404);
    expect((await own.DELETE(request("/api/user/reviews", "DELETE", { id: review.id, version: review.version }, other))).status).toBe(404);
    expect((await own.GET(request("/api/user/reviews"))).status).toBe(409);
    expect((await adminApi.GET(request("/api/admin/reviews", "GET", undefined, other))).status).toBe(403);
    actAs(seller); const ownRows = await sellerApi(request("/api/member/reviews", "GET", undefined, seller)); expect((await ownRows.json()).reviews[0].id).toBe(review.id);
    actAs(secondSeller); expect((await (await sellerApi(request("/api/member/reviews", "GET", undefined, secondSeller))).json()).total).toBe(0);
    const blocked = await db.user.update({ where: { id: secondSeller.id }, data: { sellerStatus: "BLOCKED" } }); expect((await sellerApi(request("/api/member/reviews", "GET", undefined, secondSeller))).status).toBe(409);
    actAs(blocked); expect((await sellerApi(request("/api/member/reviews", "GET", undefined, blocked))).status).toBe(403);
    actAs(buyer); await db.user.update({ where: { id: buyer.id }, data: { sessionVersion: { increment: 1 } } }); expect((await own.GET(request("/api/user/reviews"))).status).toBe(409);
    actAs(null); expect((await own.GET(request("/api/user/reviews"))).status).toBe(401);
  });
  it("withdraws without deleting history, prevents admin restoration without consent and permits owner resubmission", async () => {
    const review = await publish(await submit()); actAs(buyer);
    const response = await own.DELETE(request("/api/user/reviews", "DELETE", { id: review.id, version: review.version })); expect(response.status).toBe(200); const withdrawn = (await response.json()).review;
    expect(withdrawn.status).toBe("WITHDRAWN"); expect(await db.review.count({ where: { id: review.id } })).toBe(1); expect((await (await publicRead()).json()).total).toBe(0);
    actAs(admin); expect((await adminApi.POST(request("/api/admin/reviews", "POST", { id: review.id, version: withdrawn.version, action: "publish" }, admin))).status).toBe(409);
    const edited = await editVerifiedReview(buyer, { id: review.id, version: withdrawn.version, rating: 5, comment: "Owner chose to resubmit" }); expect(edited.status).toBe("PENDING");
  });
  it("keeps legacy feedback and duplicates private until the canonical owner explicitly resubmits a verified purchase", async () => {
    const canonical = await db.review.create({ data: { userId: buyer.id, productId: product.id, rating: 9, comment: "Old unverified text", status: "LEGACY" }, include: { product: true } });
    const duplicate = await db.review.create({ data: { userId: buyer.id, productId: product.id, rating: 0, comment: "Retained duplicate", status: "LEGACY", isCanonical: false } });
    expect((await (await publicRead()).json()).total).toBe(0); actAs(buyer);
    expect((await own.PUT(request("/api/user/reviews", "PUT", { id: duplicate.id, version: 1, rating: 5, comment: "Cannot edit duplicate" }))).status).toBe(404);
    actAs(admin); expect((await adminApi.POST(request("/api/admin/reviews", "POST", { id: canonical.id, version: 1, action: "publish" }, admin))).status).toBe(409);
    const resubmitted = await editVerifiedReview(buyer, { id: canonical.id, version: 1, rating: 3, comment: "Explicitly resubmitted purchase review" }); await publish(resubmitted);
    expect((await (await publicRead()).json()).reviews.map((review: { id: string }) => review.id)).toEqual([canonical.id]); expect((await db.review.findUniqueOrThrow({ where: { id: duplicate.id } })).comment).toBe("Retained duplicate");
  });
  it("excludes hidden products and never publishes pending, rejected, withdrawn or legacy text through the product reader", async () => {
    const review = await submit(); expect((await getPublicProduct(product.id))?.reviews).toEqual([]);
    actAs(admin); const rejected = await adminApi.POST(request("/api/admin/reviews", "POST", { id: review.id, version: review.version, action: "reject", reason: "Please describe the purchased product." }, admin)); expect(rejected.status).toBe(200);
    expect((await getPublicProduct(product.id))?.reviews).toEqual([]);
    await db.product.update({ where: { id: product.id }, data: { status: "REJECTED" } }); expect((await publicRead()).status).toBe(404);
    await db.product.update({ where: { id: product.id }, data: { status: "APPROVED" } }); await db.user.update({ where: { id: seller.id }, data: { sellerStatus: "BLOCKED" } }); expect((await publicRead()).status).toBe(404);
  });
  it("enforces score, association, moderation and canonical constraints in SQL as well as strict HTTP validation", async () => {
    for (const rating of [0, 6, 1.5]) expect((await own.POST(request("/api/user/reviews", "POST", { productId: product.id, rating, comment: null }))).status).toBe(400);
    expect((await own.POST(request("/api/user/reviews", "POST", { productId: product.id, rating: 5, comment: "x".repeat(2001) }))).status).toBe(400);
    expect((await own.POST(request("/api/user/reviews", "POST", { productId: product.id, rating: 5, comment: "bad\u0001control" }))).status).toBe(400);
    await expect(db.review.create({ data: { userId: buyer.id, productId: product.id, orderItemId: otherItem, rating: 5, status: "PENDING" } })).rejects.toThrow();
    await expect(db.review.create({ data: { userId: buyer.id, productId: secondProduct.id, orderItemId: buyerItem, rating: 5, status: "PENDING" } })).rejects.toThrow();
    await expect(db.review.create({ data: { userId: buyer.id, productId: product.id, orderItemId: buyerItem, rating: 5, status: "REJECTED", moderatedAt: new Date(), moderatedById: admin.id, moderationReason: null } })).rejects.toThrow();
    await expect(db.review.create({ data: { userId: buyer.id, productId: product.id, orderItemId: buyerItem, rating: 5, status: "PUBLISHED", isCanonical: false, moderatedAt: new Date(), moderatedById: admin.id } })).rejects.toThrow();
    const oversized = new Request("http://localhost/api/user/reviews", { method: "POST", headers: { "X-Review-Owner": buyer.id }, body: "x".repeat(8193) }); expect((await own.POST(oversized)).status).toBe(413);
    expect((await publicApi(request(`/api/reviews?productId=${product.id}&productId=${secondProduct.id}`))).status).toBe(400);
    expect((await own.GET(request("/api/user/reviews?userId=other"))).status).toBe(400);
    (rateLimit as jest.Mock).mockResolvedValue({ success: false }); const limited = await publicRead(); expect(limited.status).toBe(429); expect(limited.headers.get("retry-after")).toBe("60");
  });
  it("retains truthful public reads when purchase eligibility changes and exposes a shared aggregate reconciliation for refund integration", async () => {
    const review = await publish(await submit()), item = await db.orderItem.findUniqueOrThrow({ where: { id: buyerItem } });
    await db.order.update({ where: { id: item.orderId }, data: { paymentStatus: "FAILED" } }); expect((await (await publicRead()).json()).total).toBe(0);
    await db.$transaction(async (tx) => { await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${product.id} FOR UPDATE`; await reconcileProductReviews(tx, product.id); });
    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ rating: 0, reviewCount: 0 });
    expect((await db.review.findUniqueOrThrow({ where: { id: review.id } })).status).toBe("PUBLISHED");
  });
  it("rechecks moderator revocation after a real User lock wait and rolls back publication", async () => {
    const review = await submit(); let entered!: () => void, release!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; }), gate = new Promise<void>((resolve) => { release = resolve; });
    const blocker = db.$transaction(async (tx) => { await tx.$queryRaw`SELECT id FROM "User" WHERE id=${admin.id} FOR UPDATE`; entered(); await gate; await tx.user.update({ where: { id: admin.id }, data: { sessionVersion: { increment: 1 } } }); }, { timeout: 10_000 });
    await ready; actAs(admin); const pending = adminApi.POST(request("/api/admin/reviews", "POST", { id: review.id, version: review.version, action: "publish" }, admin));
    try {
      let waiting = false; const deadline = Date.now() + 2000;
      while (Date.now() < deadline) { const [row] = await db.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM "User"%'`; if (Number(row.total)) { waiting = true; break; } await delay(10); }
      expect(waiting).toBe(true); release(); await blocker; expect((await pending).status).toBe(409);
      expect((await db.review.findUniqueOrThrow({ where: { id: review.id } })).status).toBe("PENDING"); expect((await (await publicRead()).json()).total).toBe(0);
    } finally { release(); await blocker; await pending; }
  });
  it("never reports a committed publication as failed when catalog cache invalidation is unavailable", async () => {
    const review = await submit(); (revalidatePath as jest.Mock).mockImplementationOnce(() => { throw new Error("Cache unavailable"); }); const log = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    try { await publish(review); expect((await (await publicRead()).json()).total).toBe(1); expect(log).toHaveBeenCalledTimes(1); } finally { log.mockRestore(); }
  });
  it("rejects a seller's own-store purchase as review provenance", async () => {
    const ownPurchase = await purchase(seller.id, product.id); actAs(seller);
    const response = await own.POST(request("/api/user/reviews", "POST", { productId: product.id, rating: 5, comment: "Own store" }, seller)); expect(response.status).toBe(403);
    await expect(db.review.create({ data: { userId: seller.id, productId: product.id, orderItemId: ownPurchase.items[0].id, rating: 5, status: "PENDING" } })).rejects.toThrow();
  });
  it("serializes competing edits and moderation decisions without overwriting a newer revision", async () => {
    const review = await submit();
    const edits = await Promise.allSettled([2, 3].map((rating) => editVerifiedReview(buyer, { id: review.id, version: review.version, rating, comment: `Concurrent rating ${rating}` })));
    expect(edits.filter((result) => result.status === "fulfilled")).toHaveLength(1); expect(edits.filter((result) => result.status === "rejected")).toHaveLength(1);
    const current = await db.review.findUniqueOrThrow({ where: { id: review.id } });
    const decisions = await Promise.allSettled([moderateVerifiedReview(admin, { id: review.id, version: current.version, action: "publish" }), moderateVerifiedReview(admin, { id: review.id, version: current.version, action: "reject", reason: "Concurrent moderator decision" })]);
    expect(decisions.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const saved = await db.review.findUniqueOrThrow({ where: { id: review.id } }), aggregate = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(aggregate.reviewCount).toBe(saved.status === "PUBLISHED" ? 1 : 0); expect(aggregate.rating).toBe(saved.status === "PUBLISHED" ? saved.rating : 0);
  });
  it("rolls publication and its version back when the aggregate write fails in SQL", async () => {
    const review = await submit(), constraint = `audit_review_failure_${randomUUID().replaceAll("-", "")}`;
    if (!/^audit_review_failure_[a-f0-9]{32}$/.test(constraint) || !/^[a-f0-9-]{36}$/.test(product.id)) throw new Error("Invalid SQL fixture identifiers");
    await db.$executeRawUnsafe(`ALTER TABLE "Product" ADD CONSTRAINT "${constraint}" CHECK (id<>'${product.id}' OR "reviewCount"=0)`);
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      actAs(admin); const response = await adminApi.POST(request("/api/admin/reviews", "POST", { id: review.id, version: review.version, action: "publish" }, admin)); expect(response.status).toBe(503);
      expect(await db.review.findUniqueOrThrow({ where: { id: review.id } })).toMatchObject({ status: "PENDING", version: 1, moderatedById: null, moderatedAt: null });
      expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ rating: 0, reviewCount: 0, reviewVersion: 0 });
    } finally { log.mockRestore(); await db.$executeRawUnsafe(`ALTER TABLE "Product" DROP CONSTRAINT "${constraint}"`); }
  });
  it("paginates published, eligible and owner history records completely beyond the first page", async () => {
    const publishedRows = [];
    for (let index = 0; index < 21; index++) {
      const user = await db.user.create({ data: { email: `${prefix}-page-${index}@example.invalid`, isVerified: true } }), bought = await purchase(user.id, product.id);
      publishedRows.push({ userId: user.id, productId: product.id, orderItemId: bought.items[0].id, rating: 4, status: "PUBLISHED", comment: `Actual pagination purchase ${index}`, moderatedAt: new Date(), moderatedById: admin.id });
    }
    await db.review.createMany({ data: publishedRows });
    await db.$transaction(async (tx) => { await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${product.id} FOR UPDATE`; await reconcileProductReviews(tx, product.id); });
    const first = await (await publicRead(1)).json(), second = await (await publicRead(2)).json(); expect(first.total).toBe(21); expect(first.reviews).toHaveLength(20); expect(second.reviews).toHaveLength(1);
    expect(new Set([...first.reviews, ...second.reviews].map((review: { id: string }) => review.id)).size).toBe(21); expect((await publicRead(3)).status).toBe(404);
    const products = [];
    for (let index = 0; index < 21; index++) products.push(await db.product.create({ data: { name: `${prefix}-eligible-${index}`, slug: `${prefix}-eligible-${index}`, price: 100, stock: 1, status: "APPROVED", sellerId: seller.id, categoryId: category.id } }));
    const bought = await db.order.create({ data: { userId: buyer.id, status: "DELIVERED", paymentStatus: "PAID", total: 2100, items: { create: products.map((item) => ({ productId: item.id, quantity: 1, price: 100 })) } }, include: { items: true } });
    actAs(buyer); const eligibleOne = await (await own.GET(request("/api/user/reviews?tab=eligible&page=1"))).json(), eligibleTwo = await (await own.GET(request("/api/user/reviews?tab=eligible&page=2"))).json(); expect(eligibleOne.total).toBe(22); expect(eligibleTwo.products).toHaveLength(2);
    expect(new Set([...eligibleOne.products, ...eligibleTwo.products].map((row: { id: string }) => row.id)).size).toBe(22);
    await db.review.createMany({ data: bought.items.map((item) => ({ userId: buyer.id, productId: item.productId, orderItemId: item.id, rating: 3, status: "PENDING", comment: "Private pending purchase feedback" })) });
    const ownFirst = await (await own.GET(request("/api/user/reviews?page=1"))).json(), ownSecond = await (await own.GET(request("/api/user/reviews?page=2"))).json(); expect(ownFirst.total).toBe(21); expect(ownFirst.reviews).toHaveLength(20); expect(ownSecond.reviews).toHaveLength(1);
    actAs(admin); const pending = await adminApi.GET(request("/api/admin/reviews?status=PENDING&page=2", "GET", undefined, admin)); expect(pending.status).toBe(200); expect((await pending.json()).reviews).toHaveLength(1);
  });
});
