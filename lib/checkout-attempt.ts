import { canonicalCheckoutRequest } from "@/lib/checkout-request";
import type { CheckoutDetails } from "@/lib/validations/order";

const STORAGE_KEY = "amar-gadget-checkout-attempt-v1";
type AttemptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type CheckoutAttempt = { fingerprint: string; token: string };

function browserStorage(): AttemptStorage | undefined {
  try { return globalThis.sessionStorage; } catch { return undefined; }
}

function isAttempt(value: unknown): value is CheckoutAttempt {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.fingerprint === "string" && /^[a-f0-9]{64}$/.test(record.fingerprint)
    && typeof record.token === "string" && /^[a-f0-9]{64}$/.test(record.token);
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
  // Identity is bound by the server. Keep the browser token on account changes
  // so a stale/loading auth snapshot cannot silently create a second order.
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalCheckoutRequest(details, null)));
  const fingerprint = hex(new Uint8Array(digest));
  if (previous?.fingerprint === fingerprint) return previous;
  try {
    const stored: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) || "null");
    if (isAttempt(stored) && stored.fingerprint === fingerprint) return stored;
  } catch { /* Blocked/corrupt storage must not prevent checkout. */ }
  const attempt = { fingerprint, token: hex(globalThis.crypto.getRandomValues(new Uint8Array(32))) };
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(attempt)); } catch { /* Caller retains the in-memory attempt. */ }
  return attempt;
}

/** Avoid deleting a newer attempt when an older request finishes late. */
export function clearCheckoutAttempt(token: string, storage: AttemptStorage | undefined = browserStorage()): void {
  try {
    const stored: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) || "null");
    if (isAttempt(stored) && stored.token === token) storage?.removeItem(STORAGE_KEY);
  } catch { /* Storage is optional. */ }
}
