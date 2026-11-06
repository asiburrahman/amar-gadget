import { canonicalCheckoutRequest } from "@/lib/checkout-request";
import type { CheckoutDetails } from "@/lib/validations/order";
import type { CartCheckoutContext } from "@/lib/validations/cart";

const STORAGE_KEY = "amar-gadget-checkout-attempt-v1";
type AttemptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type AttemptScope = Pick<CartCheckoutContext, "ownerId" | "sourceId">;
export type CheckoutAttempt = { fingerprint: string; token: string; orderId?: string; storageKey?: string; cartVersion?: number; previousReceiptId?: string | null };

export function checkoutAttemptStorageKey(context?: AttemptScope | null) {
  return context ? `amar-gadget-checkout-attempt-v2:${context.ownerId === null ? `guest:${context.sourceId}` : `account:${encodeURIComponent(context.ownerId)}`}` : STORAGE_KEY;
}

function browserStorage(): AttemptStorage | undefined {
  try { return globalThis.sessionStorage; } catch { return undefined; }
}

function isAttempt(value: unknown): value is CheckoutAttempt {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.fingerprint === "string" && /^[a-f0-9]{64}$/.test(record.fingerprint)
    && typeof record.token === "string" && /^[a-f0-9]{64}$/.test(record.token)
    && (record.orderId === undefined || (typeof record.orderId === "string" && /^[a-f0-9-]{36}$/i.test(record.orderId)))
    && (record.storageKey === undefined || (typeof record.storageKey === "string" && record.storageKey.length <= 256))
    && (record.cartVersion === undefined || (Number.isInteger(record.cartVersion) && Number(record.cartVersion) >= 0))
    && (record.previousReceiptId == null || (typeof record.previousReceiptId === "string" && /^[a-f0-9-]{36}$/i.test(record.previousReceiptId)));
}

export function readCheckoutAttempt(context?: AttemptScope | null, storage: AttemptStorage | undefined = browserStorage()): CheckoutAttempt | undefined {
  try {
    const key = checkoutAttemptStorageKey(context), raw = storage?.getItem(key);
    if (!raw || raw.length > 2048) return undefined;
    const stored: unknown = JSON.parse(raw);
    if (isAttempt(stored) && (stored.storageKey ?? STORAGE_KEY) === key) return stored;
  } catch { /* The caller retains its in-memory secret when storage is blocked. */ }
  return undefined;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** No address/contact data is written to storage, only a digest and secret. */
export async function getCheckoutAttempt(
  details: CheckoutDetails,
  previous?: CheckoutAttempt,
  storage: AttemptStorage | undefined = browserStorage(),
): Promise<CheckoutAttempt> {
  // Modern carts isolate secrets by actual account/guest source. The server
  // still derives identity and binds the complete canonical request itself.
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalCheckoutRequest(details, null)));
  const fingerprint = hex(new Uint8Array(digest));
  const key = checkoutAttemptStorageKey(details.cart);
  const reusable = (value: CheckoutAttempt | undefined) => value && (value.storageKey ?? STORAGE_KEY) === key
    && (value.fingerprint === fingerprint || (details.cart?.ownerId === null && (value.previousReceiptId ?? null) === (details.cart.previousReceiptId ?? null)));
  if (reusable(previous)) return previous!;
  const stored = readCheckoutAttempt(details.cart, storage);
  if (reusable(stored)) return stored!;
  const attempt: CheckoutAttempt = { fingerprint, token: hex(globalThis.crypto.getRandomValues(new Uint8Array(32))),
    ...(details.cart ? { storageKey: key, cartVersion: details.cart.version, previousReceiptId: details.cart.previousReceiptId ?? null } : {}),
  };
  try { storage?.setItem(key, JSON.stringify(attempt)); } catch { /* Caller retains the in-memory attempt. */ }
  return attempt;
}

/** Avoid deleting a newer attempt when an older request finishes late. */
export function clearCheckoutAttempt(attempt: string | CheckoutAttempt, storage: AttemptStorage | undefined = browserStorage()): void {
  try {
    const key = typeof attempt === "string" ? STORAGE_KEY : attempt.storageKey ?? STORAGE_KEY;
    const token = typeof attempt === "string" ? attempt : attempt.token;
    const stored: unknown = JSON.parse(storage?.getItem(key) || "null");
    if (isAttempt(stored) && stored.token === token) storage?.removeItem(key);
  } catch { /* Storage is optional. */ }
}

export function bindCheckoutAttempt(attempt: CheckoutAttempt, orderId: string, storage: AttemptStorage | undefined = browserStorage()): CheckoutAttempt {
  const bound = { ...attempt, orderId };
  try {
    const key = attempt.storageKey ?? STORAGE_KEY;
    const stored: unknown = JSON.parse(storage?.getItem(key) || "null");
    if (isAttempt(stored) && stored.token === attempt.token) storage?.setItem(key, JSON.stringify(bound));
  } catch { /* In-memory fallback remains valid. */ }
  return bound;
}

export function clearCheckoutAttemptForOrder(orderId: string, storage: AttemptStorage | undefined = browserStorage(), context?: CartCheckoutContext | null): void {
  try {
    const key = checkoutAttemptStorageKey(context);
    const stored: unknown = JSON.parse(storage?.getItem(key) || "null");
    if (isAttempt(stored) && stored.orderId === orderId) storage?.removeItem(key);
  } catch { /* Storage is optional. */ }
}
