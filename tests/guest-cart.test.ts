import { randomUUID } from "node:crypto";
import { acknowledgeGuestReceipt, clearGuestItems, createGuestCartRepository, emptyGuestCart, GUEST_CART_KEY, guestCheckoutContext, rememberGuestReceipt, removeGuestLine, setGuestCoupon, setGuestQuantity, settleGuestReceipt } from "@/lib/client/guest-cart";

const product = randomUUID(), replacement = randomUUID();
const initial = () => setGuestQuantity(emptyGuestCart(), product, 3);
function fixture() {
  const values = new Map<string, string>(); let blocked = false;
  const storage = {
    getItem: jest.fn((key: string) => values.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => { if (blocked) throw new Error("Quota exceeded"); values.set(key, value); }),
    removeItem: jest.fn((key: string) => { values.delete(key); }),
  };
  const deps = { storage: () => storage };
  return { values, storage, deps, repo: createGuestCartRepository(deps), block: (value: boolean) => { blocked = value; } };
}
describe("guest cart persistence and actual receipt transitions", () => {
  it("stores only identifiers, quantities, coupon intent and bounded receipt references", async () => {
    const { repo, values } = fixture(); let { cart } = await repo.initialize();
    ({ cart } = await repo.change(cart, (value) => setGuestQuantity(value, product, 2)));
    const saved = JSON.parse(values.get(GUEST_CART_KEY)!);
    expect(saved.lines[0]).toEqual({ productId: product, lineId: expect.any(String), quantity: 2, version: 1 });
    expect(saved).not.toHaveProperty("items"); expect(saved).not.toHaveProperty("name");
    expect(cart.version).toBe(1); expect(cart.revision).toBe(1);
    expect(guestCheckoutContext(cart)).toMatchObject({ ownerId: null, sourceId: cart.id, version: 1, previousReceiptId: null });
  });
  it("rejects invalid quantities, identifiers, extra metadata and the distinct product cap", () => {
    const cart = initial();
    for (const quantity of [0, -1, 1.5, 101, NaN]) expect(() => setGuestQuantity(cart, product, quantity)).toThrow();
    expect(() => setGuestQuantity(cart, "not-a-product", 1)).toThrow();
    let full = emptyGuestCart();
    for (let index = 0; index < 100; index++) full = setGuestQuantity(full, randomUUID(), 1);
    expect(() => setGuestQuantity(full, randomUUID(), 1)).toThrow("100");
    expect(setGuestQuantity(full, full.lines[0].productId, 2).lines).toHaveLength(100);
  });
  it("preserves stable line identity on quantity edits and creates new identity after removal", () => {
    const cart = initial(), lineId = cart.lines[0].lineId;
    const increased = setGuestQuantity(cart, product, 4); expect(increased.lines[0].lineId).toBe(lineId);
    const readded = setGuestQuantity(removeGuestLine(increased, lineId), product, 1);
    expect(readded.lines[0].lineId).not.toBe(lineId);
  });
  it("subtracts purchased quantities once and keeps extra quantities and a newly added product", () => {
    const cart = initial(), context = guestCheckoutContext(cart), orderId = randomUUID(); context.lines[0].quantity = 1;
    const pending = rememberGuestReceipt(cart, orderId, context), edited = setGuestQuantity(setGuestQuantity(pending, product, 5), replacement, 2);
    const settled = settleGuestReceipt(edited, orderId, context, "purchased");
    expect(settled.lines.map((line) => line.quantity)).toEqual([4, 2]);
    expect(settled.ackPending).toEqual({ orderId, version: context.version }); expect(settled.pending).toEqual([]);
    expect(settleGuestReceipt(settled, orderId, context, "purchased")).toBe(settled);
    expect(() => guestCheckoutContext(settled)).toThrow("earlier");
    const acknowledged = acknowledgeGuestReceipt(settled, orderId);
    expect(guestCheckoutContext(acknowledged)).toMatchObject({ previousReceiptId: orderId, version: edited.version + 1 });
    expect(settleGuestReceipt(acknowledged, orderId, context, "purchased")).toBe(acknowledged);
  });
  it("keeps a removed/re-added item and a re-applied identical coupon", () => {
    const cart = setGuestCoupon(initial(), " save "), context = guestCheckoutContext(cart), orderId = randomUUID();
    const edited = setGuestCoupon(setGuestQuantity(removeGuestLine(cart, cart.lines[0].lineId), product, 2), "SAVE");
    const settled = settleGuestReceipt(edited, orderId, context, "purchased");
    expect(settled.lines).toEqual(edited.lines); expect(settled.couponCode).toBe("SAVE"); expect(settled.couponVersion).toBe(2);
  });
  it("clears only the consumed coupon intent and preserves it on a closed/cancelled order", () => {
    const cart = setGuestCoupon(initial(), "SAVE"), context = guestCheckoutContext(cart), orderId = randomUUID();
    const paid = settleGuestReceipt(cart, orderId, context, "purchased"); expect(paid.lines).toEqual([]); expect(paid.couponCode).toBeNull();
    const closed = settleGuestReceipt(cart, orderId, context, "closed"); expect(closed.lines).toEqual(cart.lines); expect(closed.couponCode).toBe("SAVE");
    expect(closed.version).toBeGreaterThan(context.version); expect(closed.ackPending?.orderId).toBe(orderId);
  });
  it("clearing visible items retains pending checkout recovery and source identity", () => {
    const cart = initial(), orderId = randomUUID(), pending = rememberGuestReceipt(cart, orderId, guestCheckoutContext(cart));
    const cleared = clearGuestItems(pending); expect(cleared.lines).toEqual([]); expect(cleared.pending).toEqual(pending.pending); expect(cleared.id).toBe(cart.id);
    expect(() => guestCheckoutContext(cleared)).toThrow();
  });
  it("never associates a foreign account/source receipt or accepts a second pending receipt", () => {
    const cart = initial(), context = guestCheckoutContext(cart), orderId = randomUUID();
    expect(() => rememberGuestReceipt(cart, orderId, { ...context, sourceId: randomUUID() })).toThrow("different cart");
    expect(() => settleGuestReceipt(cart, orderId, { ...context, ownerId: "another-owner", sourceId: null }, "purchased")).toThrow("different cart");
    const pending = rememberGuestReceipt(cart, orderId, context);
    expect(() => rememberGuestReceipt(pending, randomUUID(), context)).toThrow("earlier");
    expect(acknowledgeGuestReceipt(pending, orderId)).toBe(pending);
  });
  it("rejects observed competing-tab revisions without overwriting either cart", async () => {
    const { repo, deps, values } = fixture(), first = await repo.initialize(), other = createGuestCartRepository(deps), second = other.read();
    await repo.change(first.cart, (value) => setGuestQuantity(value, product, 1)); const saved = values.get(GUEST_CART_KEY);
    await expect(other.change(second, (value) => setGuestQuantity(value, replacement, 1))).rejects.toThrow("another tab");
    expect(values.get(GUEST_CART_KEY)).toBe(saved); expect(other.read().lines[0].productId).toBe(product);
  });
  it("keeps new tab-only changes when writes fail but stale disk remains readable", async () => {
    const { repo, block, values } = fixture(); let { cart } = await repo.initialize();
    ({ cart } = await repo.change(cart, (value) => setGuestQuantity(value, product, 1)));
    block(true); const changed = await repo.change(cart, (value) => setGuestQuantity(value, product, 4));
    expect(changed.durable).toBe(false); expect(repo.read().lines[0].quantity).toBe(4);
    expect(JSON.parse(values.get(GUEST_CART_KEY)!).lines[0].quantity).toBe(1);
    block(false); const flushed = await repo.flush(); expect(flushed.durable).toBe(true); expect(repo.isMemoryOnly()).toBe(false);
    expect(JSON.parse(values.get(GUEST_CART_KEY)!).lines[0].quantity).toBe(4);
  });
  it("refuses to flush a memory-only change over another tab's newer durable cart", async () => {
    const { repo, deps, block, values } = fixture(); const { cart } = await repo.initialize();
    block(true); await repo.change(cart, (value) => setGuestQuantity(value, product, 2)); block(false);
    const other = createGuestCartRepository(deps); const current = other.read();
    await other.change(current, (value) => setGuestQuantity(value, replacement, 1)); const saved = values.get(GUEST_CART_KEY);
    await expect(repo.flush()).rejects.toThrow("another tab"); expect(values.get(GUEST_CART_KEY)).toBe(saved);
    expect(repo.read().lines[0].productId).toBe(product);
  });
  it("refreshes another tab's durable update before an ordinary flush instead of overwriting it", async () => {
    const { repo, deps } = fixture(); await repo.initialize(); const other = createGuestCartRepository(deps), original = other.read();
    await other.change(original, (value) => setGuestQuantity(value, product, 2));
    const saved = await repo.flush(); expect(saved.durable).toBe(true); expect(saved.cart.lines[0].quantity).toBe(2);
  });
  it("persists receipt cleanup before ack and resumes an interrupted acknowledgement after reload", async () => {
    const { repo, deps } = fixture(); let { cart } = await repo.initialize();
    ({ cart } = await repo.change(cart, (value) => setGuestQuantity(value, product, 3)));
    const context = guestCheckoutContext(cart), orderId = randomUUID(); context.lines[0].quantity = 1;
    await repo.change(cart, (value) => settleGuestReceipt(value, orderId, context, "purchased"));
    const reopened = createGuestCartRepository(deps), pending = reopened.read(); expect(pending.lines[0].quantity).toBe(2); expect(pending.ackPending?.orderId).toBe(orderId);
    const { cart: acknowledged } = await reopened.change(pending, (value) => acknowledgeGuestReceipt(value, orderId));
    expect(acknowledged.previousReceiptId).toBe(orderId); expect(acknowledged.lines[0].quantity).toBe(2);
  });
  it("does not acknowledge durably when cleanup could only be kept in memory", async () => {
    const { repo, block } = fixture(); let { cart } = await repo.initialize();
    ({ cart } = await repo.change(cart, (value) => setGuestQuantity(value, product, 3)));
    const context = guestCheckoutContext(cart), orderId = randomUUID(); block(true);
    const result = await repo.change(cart, (value) => settleGuestReceipt(value, orderId, context, "purchased"));
    expect(result.durable).toBe(false); expect(result.cart.previousReceiptId).toBeNull(); expect(result.cart.ackPending?.orderId).toBe(orderId);
    expect(() => guestCheckoutContext(result.cart)).toThrow();
  });
  it("retains malformed, oversized or metadata-contaminated modern storage for explicit review", async () => {
    const { repo, values } = fixture();
    for (const raw of ["{bad", "x".repeat(262145), JSON.stringify({ ...initial(), shippingAddress: "private" })]) {
      values.set(GUEST_CART_KEY, raw); await expect(repo.initialize()).rejects.toThrow("retained"); expect(values.get(GUEST_CART_KEY)).toBe(raw);
    }
  });
  it("uses a fresh source after another tab removes durable storage and returns copies", async () => {
    const { repo, values } = fixture(); const { cart } = await repo.initialize();
    cart.lines.push({ productId: product, lineId: randomUUID(), quantity: 1, version: 1 }); expect(repo.read().lines).toEqual([]);
    values.delete(GUEST_CART_KEY); expect(repo.read().id).not.toBe(cart.id);
  });
  it("falls back when browser locks are unavailable without replaying a callback that already ran", async () => {
    const storageFixture = fixture();
    const refused = createGuestCartRepository({ ...storageFixture.deps, lock: async () => { throw new Error("Unsupported"); } });
    expect((await refused.initialize()).durable).toBe(true);
    const entered = createGuestCartRepository({ ...storageFixture.deps, lock: async (work) => { await work(); throw new Error("After callback"); } });
    const transform = jest.fn((value) => setGuestQuantity(value, product, 1));
    await expect(entered.change(entered.read(), transform)).rejects.toThrow("After callback"); expect(transform).toHaveBeenCalledTimes(1);
  });
});
