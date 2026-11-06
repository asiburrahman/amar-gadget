import { randomUUID, webcrypto } from "node:crypto";
import { getCheckoutAttempt, clearCheckoutAttempt, bindCheckoutAttempt, checkoutAttemptStorageKey, clearCheckoutAttemptForOrder, readCheckoutAttempt, type CheckoutAttempt } from "../../lib/checkout-attempt";
import type { CheckoutDetails } from "../../lib/validations/order";
import type { CartCheckoutContext } from "@/lib/validations/cart";

Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });

const details: CheckoutDetails = {
  items: [{ productId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", quantity: 1 }],
  fullName: "Private customer", phone: "01700000000", street: "Private street",
  city: "Dhaka", district: "Dhaka", paymentMethod: "COD",
};
function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
    data,
  };
}

describe("browser checkout attempts", () => {
  it("reuses an attempt across reload/retry without persisting contact details", async () => {
    const storage = memoryStorage();
    const first = await getCheckoutAttempt(details, undefined, storage);
    const retry = await getCheckoutAttempt(details, undefined, storage);
    expect(retry).toEqual(first);
    expect(first.token).toMatch(/^[a-f0-9]{64}$/);
    const serialized = [...storage.data.values()].join();
    for (const privateValue of [details.fullName, details.street, details.phone]) expect(serialized).not.toContain(privateValue);
  });

  it("uses a new intent for changed cart, address or payment", async () => {
    const storage = memoryStorage();
    const first = await getCheckoutAttempt(details, undefined, storage);
    const changes: CheckoutDetails[] = [
      { ...details, items: [{ ...details.items[0], quantity: 2 }] },
      { ...details, street: "Changed address" },
      { ...details, paymentMethod: "STRIPE" },
    ];
    for (const change of changes) expect((await getCheckoutAttempt(change, first, storage)).token).not.toBe(first.token);
  });

  it("keeps the in-memory attempt when browser storage is blocked", async () => {
    const blocked = {
      getItem: () => { throw new Error("Storage disabled"); },
      setItem: () => { throw new Error("Storage disabled"); },
      removeItem: () => { throw new Error("Storage disabled"); },
    };
    const first = await getCheckoutAttempt(details, undefined, blocked);
    expect(await getCheckoutAttempt(details, first, blocked)).toEqual(first);
    expect(() => clearCheckoutAttempt(first.token, blocked)).not.toThrow();
  });

  it("does not clear a newer intent when a stale request finishes", async () => {
    const storage = memoryStorage();
    const first = await getCheckoutAttempt(details, undefined, storage);
    const newer = await getCheckoutAttempt({ ...details, street: "New address" }, first, storage);
    clearCheckoutAttempt(first.token, storage);
    expect(await getCheckoutAttempt({ ...details, street: "New address" }, undefined, storage)).toEqual(newer);
    clearCheckoutAttempt(newer.token, storage);
    expect(storage.data.size).toBe(0);
  });

  const guestContext = (): CartCheckoutContext => ({ ownerId: null, sourceId: randomUUID(), version: 1, couponVersion: 0, couponCode: null, previousReceiptId: null, lines: [{ ...details.items[0], lineId: randomUUID() }] });
  it("isolates account A, account B, guest source and legacy checkout secrets", async () => {
    const storage = memoryStorage(), guest = guestContext();
    const carts = [undefined, guest, { ...guest, ownerId: "owner-a", sourceId: null }, { ...guest, ownerId: "owner-b", sourceId: null }];
    const attempts: CheckoutAttempt[] = [];
    for (const cart of carts) attempts.push(await getCheckoutAttempt({ ...details, cart }, attempts[attempts.length - 1], storage));
    expect(new Set(attempts.map((attempt) => attempt.token)).size).toBe(4); expect(storage.data.size).toBe(4);
    for (let index = 0; index < carts.length; index++) expect(readCheckoutAttempt(carts[index], storage)?.token).toBe(attempts[index].token);
  });
  it("keeps the original guest secret after unknown responses even if address/cart/payment changes", async () => {
    const storage = memoryStorage(), cart = guestContext();
    const first = await getCheckoutAttempt({ ...details, cart }, undefined, storage);
    const changed = { ...details, street: "New address", paymentMethod: "STRIPE" as const, cart: { ...cart, version: 2 } };
    expect(await getCheckoutAttempt(changed, first, storage)).toEqual(first);
    expect(await getCheckoutAttempt(changed, undefined, storage)).toEqual(first);
    expect(storage.data.size).toBe(1);
  });
  it("allows a new guest token only after the acknowledged receipt advances", async () => {
    const storage = memoryStorage(), cart = guestContext();
    const first = await getCheckoutAttempt({ ...details, cart }, undefined, storage);
    const advanced = { ...cart, version: cart.version + 1, previousReceiptId: randomUUID() };
    const second = await getCheckoutAttempt({ ...details, cart: advanced }, first, storage);
    expect(second.token).not.toBe(first.token); expect(second.previousReceiptId).toBe(advanced.previousReceiptId);
  });
  it("does not rebind or erase a newer account attempt after an old response finishes", async () => {
    const storage = memoryStorage(), cart = { ...guestContext(), ownerId: "owner-a", sourceId: null };
    const first = await getCheckoutAttempt({ ...details, cart }, undefined, storage);
    const changed = { ...details, cart: { ...cart, version: cart.version + 1 } };
    const newer = await getCheckoutAttempt(changed, first, storage);
    bindCheckoutAttempt(first, randomUUID(), storage); clearCheckoutAttempt(first, storage);
    expect(readCheckoutAttempt(cart, storage)).toEqual(newer);
  });
  it("clears the actual completed order namespace without removing another account or newer order", async () => {
    const storage = memoryStorage(), cart = guestContext(), accountCart = { ...cart, ownerId: "owner-a", sourceId: null }, orderId = randomUUID();
    const guest = bindCheckoutAttempt(await getCheckoutAttempt({ ...details, cart }, undefined, storage), orderId, storage);
    const account = await getCheckoutAttempt({ ...details, cart: accountCart }, guest, storage);
    clearCheckoutAttemptForOrder(randomUUID(), storage, cart); expect(readCheckoutAttempt(cart, storage)).toEqual(guest);
    clearCheckoutAttemptForOrder(orderId, storage, cart); expect(readCheckoutAttempt(cart, storage)).toBeUndefined();
    expect(readCheckoutAttempt(accountCart, storage)).toEqual(account);
  });
  it("quarantines copied, oversized and malformed session receipts from the wrong namespace", async () => {
    const storage = memoryStorage(), cart = guestContext(), key = checkoutAttemptStorageKey(cart);
    const legacy = await getCheckoutAttempt(details, undefined, storage);
    storage.setItem(key, JSON.stringify(legacy)); expect(readCheckoutAttempt(cart, storage)).toBeUndefined();
    storage.setItem(key, "x".repeat(2049)); expect(readCheckoutAttempt(cart, storage)).toBeUndefined();
    storage.setItem(key, JSON.stringify({ ...legacy, storageKey: key, orderId: { unsafe: true } })); expect(readCheckoutAttempt(cart, storage)).toBeUndefined();
  });
});
