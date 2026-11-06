import { randomUUID } from "node:crypto";
import { createLegacyCartRepository, inspectLegacyCart } from "@/lib/client/legacy-cart";
import { LEGACY_CART_KEY } from "@/lib/client/guest-cart";
const id = randomUUID(), orderId = randomUUID(), lineId = randomUUID();
function fixture(items: unknown[] = [{ id, lineId, quantity: 3, name: "Untrusted cached title", price: 1, stock: 9999 }], pendingCheckouts: unknown = {}) {
  const values = new Map([[LEGACY_CART_KEY, JSON.stringify({ version: 0, state: { items, couponCode: " save ", pendingCheckouts, unknownLegacyField: "retained" } })]]);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const repo = createLegacyCartRepository({ storage: () => storage });
  return { values, storage, repo, raw: () => JSON.parse(values.get(LEGACY_CART_KEY)!) };
}
describe("explicit quarantine and staged recovery of ownerless legacy carts", () => {
  it("exposes bounded ID/quantity review data without displaying cached metadata", () => {
    const f = fixture(), summary = f.repo.read().summary;
    expect(summary).toMatchObject({ rows: [{ index: 0, productId: id, quantity: 3, problem: null }], couponCode: "SAVE", totalRows: 1 });
    expect(JSON.stringify(summary)).not.toContain("Untrusted"); expect(JSON.stringify(summary)).not.toContain("price"); expect(JSON.stringify(summary)).not.toContain("stock");
  });
  it("retains malformed, oversized and excessive legacy records without substituting an empty cart", () => {
    for (const raw of ["{", "x".repeat(1_048_577), JSON.stringify({ state: { items: "wrong" } }), JSON.stringify({ state: { items: new Array(10001).fill({ id, quantity: 1 }) } })]) expect(inspectLegacyCart(raw)).toMatchObject({ present: true, invalid: true });
  });
  it("makes invalid quantity repair explicit and preserves the rest of the original document", async () => {
    const f = fixture([{ id, lineId, quantity: 1000, name: "Untrusted cached title" }, { id: "broken", quantity: 1 }]);
    expect(f.repo.read().summary.rows[0].quantity).toBeNull(); expect(() => f.repo.importable(f.repo.read(), [0])).toThrow("Repair");
    await expect(f.repo.repairQuantity(f.repo.read(), 0, 101)).rejects.toThrow();
    await f.repo.repairQuantity(f.repo.read(), 0, 2);
    expect(f.repo.importable(f.repo.read(), [0])).toEqual([{ index: 0, productId: id, quantity: 2 }]);
    expect(f.raw().state.items[0].name).toBe("Untrusted cached title"); expect(f.raw().state.items[1].id).toBe("broken"); expect(f.raw().state.unknownLegacyField).toBe("retained");
    await expect(f.repo.repairQuantity(f.repo.read(), 1, 1)).rejects.toThrow("valid product");
  });
  it("retains rows not selected in a bounded import and consumes the coupon only on explicit instruction", async () => {
    const other = randomUUID(), f = fixture([{ id, quantity: 1 }, { id: other, quantity: 2 }]);
    const snapshot = f.repo.read(); expect(f.repo.importable(snapshot, [0])).toHaveLength(1);
    await f.repo.removeImportedRows(snapshot, [0]); expect(f.raw().state.items).toEqual([{ id: other, quantity: 2 }]); expect(f.raw().state.couponCode).toBe(" save ");
    await f.repo.removeImportedRows(f.repo.read(), [0], true); expect(f.raw().state.couponCode).toBeNull();
  });
  it("rejects repeated/stale cleanup after a competing browser tab changes a saved row", async () => {
    const f = fixture(), old = f.repo.read(); await f.repo.repairQuantity(old, 0, 4);
    await expect(f.repo.removeImportedRows(old, [0])).rejects.toThrow("another tab"); expect(f.raw().state.items[0].quantity).toBe(4);
    expect(() => f.repo.importable(old, [0])).toThrow("another tab");
  });
  it("blocks imports until every pending or malformed receipt has been explicitly handled", () => {
    for (const pending of [{ [orderId]: { items: [] } }, { "invalid-order": {} }, "malformed"]) {
      const f = fixture(undefined, pending); expect(() => f.repo.importable(f.repo.read(), [0])).toThrow("every older checkout");
    }
  });
  it("keeps pending Stripe rows intact until authorized payment confirmation or closure", async () => {
    const f = fixture(undefined, { [orderId]: { items: [{ productId: id, lineId, quantity: 1 }] } });
    await expect(f.repo.settleReceipt(f.repo.read(), { id: orderId, status: "PENDING", paymentStatus: "UNPAID", paymentMethod: "STRIPE" })).rejects.toThrow("still pending");
    expect(f.raw().state.items[0].quantity).toBe(3); expect(f.raw().state.pendingCheckouts[orderId]).toBeDefined();
    await f.repo.settleReceipt(f.repo.read(), { id: orderId, status: "CANCELLED", paymentStatus: "PAID", paymentMethod: "STRIPE" });
    expect(f.raw().state.items[0].quantity).toBe(3); expect(f.raw().state.pendingCheckouts).toEqual({});
  });
  it("subtracts purchased quantities once only for captured product and line identity", async () => {
    const otherLine = randomUUID(), f = fixture([{ id, lineId, quantity: 3 }, { id, lineId: otherLine, quantity: 2 }], { [orderId]: { items: [{ productId: id, lineId, quantity: 1 }] } });
    const order = { id: orderId, status: "PROCESSING", paymentStatus: "UNPAID", paymentMethod: "COD" };
    await f.repo.settleReceipt(f.repo.read(), order); expect(f.raw().state.items.map((row: { quantity: number }) => row.quantity)).toEqual([2, 2]);
    await f.repo.settleReceipt(f.repo.read(), order); expect(f.raw().state.items.map((row: { quantity: number }) => row.quantity)).toEqual([2, 2]);
    expect(f.raw().state.couponCode).toBe(" save ");
  });
  it("does not fabricate line identity when an older paid receipt or row has none", async () => {
    const f = fixture(undefined, { [orderId]: { items: [{ productId: id, quantity: 1 }] } });
    await f.repo.settleReceipt(f.repo.read(), { id: orderId, status: "PROCESSING", paymentStatus: "PAID", paymentMethod: "STRIPE" });
    expect(f.raw().state.items[0].quantity).toBe(3); expect(f.raw().state.pendingCheckouts).toEqual({});
    expect(f.repo.importable(f.repo.read(), [0])).toHaveLength(1);
  });
  it("retains raw data when browser cleanup fails and supports an explicit whole-cache discard", async () => {
    const f = fixture(), raw = f.values.get(LEGACY_CART_KEY); jest.spyOn(f.storage, "setItem").mockImplementationOnce(() => { throw new Error("Quota"); });
    await expect(f.repo.removeImportedRows(f.repo.read(), [0])).rejects.toThrow("could not be updated"); expect(f.values.get(LEGACY_CART_KEY)).toBe(raw);
    await f.repo.discard(f.repo.read()); expect(f.values.has(LEGACY_CART_KEY)).toBe(false); expect(f.repo.read().summary.present).toBe(false);
  });
});
