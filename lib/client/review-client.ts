import { useAuthStore } from "@/stores/auth-store";
export class ReviewClientError extends Error {
  constructor(message: string, readonly code = "REVIEW_REQUEST", readonly status = 0) { super(message); }
}
export function currentReviewScope(ownerId: string) {
  const { user, loading } = useAuthStore.getState();
  return !loading && user?.id === ownerId && user.isVerified ? `${user.id}:${user.role}:${user.sellerStatus ?? ""}` : null;
}
/** Private responses must match both the captured client scope and the real
 * server owner precondition; an obsolete result never becomes another draft. */
export async function fetchReviewJson<T>(url: string, init: RequestInit = {}, ownerId?: string): Promise<T> {
  const scope = ownerId ? currentReviewScope(ownerId) : null;
  if (ownerId && !scope) throw new ReviewClientError("The active account changed. Reload reviews for your current account.", "REVIEW_ACCOUNT_CHANGED");
  const controller = new AbortController(), parent = init.signal;
  const abort = () => controller.abort(); parent?.addEventListener("abort", abort, { once: true }); if (parent?.aborted) abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 30_000);
  try {
    const headers = new Headers(init.headers);
    if (init.body) headers.set("Content-Type", "application/json");
    if (ownerId) headers.set("X-Review-Owner", ownerId);
    const response = await fetch(url, { ...init, cache: "no-store", headers, signal: controller.signal });
    const data = await response.json();
    if (controller.signal.aborted) throw new ReviewClientError("Review request was cancelled.", "REVIEW_ABORTED");
    if (ownerId && currentReviewScope(ownerId) !== scope) throw new ReviewClientError("The active review account changed.", "REVIEW_ACCOUNT_CHANGED");
    if (!response.ok || data.success === false) {
      if (ownerId && (data.code === "REVIEW_ACCOUNT_CHANGED" || [401, 403].includes(response.status))) void useAuthStore.getState().fetchUser();
      throw new ReviewClientError(data.message || "Unable to confirm this review request. Reload before retrying.", data.code, response.status);
    }
    if (ownerId && data.ownerId !== ownerId) throw new ReviewClientError("The returned review owner changed. Reload your session.", "REVIEW_ACCOUNT_CHANGED");
    return data as T;
  } catch (error) {
    if (timedOut) throw new ReviewClientError("Review request timed out. Reload the current state before retrying.", "REVIEW_TIMEOUT");
    throw error;
  } finally { clearTimeout(timer); parent?.removeEventListener("abort", abort); }
}
