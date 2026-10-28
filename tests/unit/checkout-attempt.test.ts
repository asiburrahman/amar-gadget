import { webcrypto } from "node:crypto";
import { getCheckoutAttempt, clearCheckoutAttempt } from "../../lib/checkout-attempt";
import type { CheckoutDetails } from "../../lib/validations/order";

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
});
