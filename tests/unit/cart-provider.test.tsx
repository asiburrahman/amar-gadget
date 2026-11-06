/** @jest-environment jsdom */
import { webcrypto } from "node:crypto";
import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CartSync } from "@/components/account/cart-sync";
import { useCartStore } from "@/stores/cart-store";
import { useAuthStore } from "@/stores/auth-store";
import { emptyGuestCart, GUEST_CART_KEY, LEGACY_CART_KEY, setGuestQuantity } from "@/lib/client/guest-cart";
Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
if (typeof structuredClone === "undefined") Object.defineProperty(globalThis, "structuredClone", { value: (value: unknown) => JSON.parse(JSON.stringify(value)), configurable: true });
const initial = useCartStore.getState(), owner = { id: "owner", name: "Owner", email: "owner@example.invalid", role: "USER", avatar: null, isVerified: true };
const productId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const product = { id: productId, name: "Current product", slug: "current-product", price: 100, discountPrice: 80, stock: 10, imageUrl: null, category: "Phones" };
const response = (data: unknown) => ({ ok: true, json: async () => data }) as Response;
const snapshot = (ownerId = "owner", lines: unknown[] = []) => ({ success: true, ownerId, version: 0, couponCode: null, couponVersion: 0, lines, pendingCheckouts: {} });
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); useCartStore.setState(initial, true);
  useAuthStore.setState({ user: owner, loading: false, fetchUser: jest.fn().mockImplementation(async () => useAuthStore.getState().user) });
  global.fetch = jest.fn().mockImplementation(async (_url, init: RequestInit) => response(snapshot((init.headers as Record<string, string>)["X-Cart-Owner"])));
});
afterEach(() => { useCartStore.getState().cancel(); jest.useRealTimers(); });
it("offers explicit max-quantity guest merge and removes only acknowledged unchanged guest lines", async () => {
  localStorage.setItem(GUEST_CART_KEY, JSON.stringify(setGuestQuantity(emptyGuestCart(), productId, 2))); let merged = false;
  (fetch as jest.Mock).mockImplementation(async (_url, init: RequestInit) => {
    if (init.method === "POST") { merged = true; return response({ success: true, ownerId: "owner", acceptedIds: [productId], skippedIds: [], version: 1 }); }
    return response(snapshot("owner", merged ? [{ id: productId, lineId: "server-line", lineVersion: 1, quantity: 2, product }] : []));
  });
  render(<CartSync />); const button = await screen.findByRole("button", { name: "Merge guest cart into this account" });
  await waitFor(() => expect(button).toHaveProperty("disabled", false)); expect((fetch as jest.Mock).mock.calls.some(([, init]) => init.method === "POST")).toBe(false);
  fireEvent.click(button); await waitFor(() => expect(JSON.parse(localStorage.getItem(GUEST_CART_KEY)!).lines).toEqual([]));
  const [, init] = (fetch as jest.Mock).mock.calls.find(([, init]) => init.method === "POST");
  expect(JSON.parse(init.body)).toMatchObject({ action: "merge", version: 0, items: [{ productId, quantity: 2 }] }); expect(init.headers["X-Cart-Owner"]).toBe(owner.id);
});
it("clears old account state immediately and aborts old reads across an auth transition", async () => {
  const waiting: ((value: Response) => void)[] = [];
  (fetch as jest.Mock).mockImplementation((_url, init: RequestInit) => (init.headers as Record<string, string>)["X-Cart-Owner"] === owner.id ? Promise.resolve(response(snapshot(owner.id, [{ id: productId, lineId: "old-line", lineVersion: 1, quantity: 1, product }]))) : new Promise<Response>((resolve) => waiting.push(resolve)));
  render(<CartSync />); await waitFor(() => expect(useCartStore.getState().items).toHaveLength(1));
  act(() => useAuthStore.setState({ user: { ...owner, id: "another-owner" } }));
  expect(useCartStore.getState().items).toEqual([]); expect(useCartStore.getState().pendingCheckouts).toEqual({}); expect(useCartStore.getState().scope).toBe("account:another-owner");
  await act(async () => { for (const finish of waiting) finish(response(snapshot("another-owner"))); });
  await waitFor(() => expect(useCartStore.getState().status).toBe("ready")); expect(useCartStore.getState().items).toEqual([]);
});
it("revalidates session and cart on focus/schedule and removes subscriptions and timers on unmount", async () => {
  jest.useFakeTimers(); let view!: ReturnType<typeof render>;
  const intervals = jest.spyOn(global, "setInterval"), cleared = jest.spyOn(global, "clearInterval");
  await act(async () => { view = render(<CartSync />); }); expect(useCartStore.getState().status).toBe("ready"); const before = (fetch as jest.Mock).mock.calls.length;
  await act(async () => fireEvent.focus(window)); expect(useAuthStore.getState().fetchUser).toHaveBeenCalled(); expect((fetch as jest.Mock).mock.calls.length).toBeGreaterThan(before);
  const reads = (fetch as jest.Mock).mock.calls.length; await act(async () => jest.advanceTimersByTime(30_000)); expect((fetch as jest.Mock).mock.calls.length).toBeGreaterThan(reads);
  const index = intervals.mock.calls.findIndex(([, delay]) => delay === 30_000); view.unmount(); expect(cleared).toHaveBeenCalledWith(intervals.mock.results[index].value);
  const stopped = (fetch as jest.Mock).mock.calls.length; await act(async () => jest.advanceTimersByTime(60_000)); expect((fetch as jest.Mock).mock.calls.length).toBe(stopped);
  intervals.mockRestore(); cleared.mockRestore();
});
it("recovers through Strict Mode cleanup without leaving private state or a busy flag behind", async () => {
  render(<StrictMode><CartSync /></StrictMode>); await waitFor(() => expect(useCartStore.getState().status).toBe("ready")); expect(useCartStore.getState().busy).toBe(false);
});
it("requires review and a separate discard confirmation for older ownerless browser data", async () => {
  const raw = JSON.stringify({ state: { items: [{ id: productId, name: "Cached private title", price: 1, quantity: 2 }] } }); localStorage.setItem(LEGACY_CART_KEY, raw);
  render(<CartSync />); await screen.findByText(/Older browser cart data/); expect(screen.queryByText("Cached private title")).toBeNull(); expect(localStorage.getItem(LEGACY_CART_KEY)).toBe(raw);
  fireEvent.click(screen.getByRole("button", { name: "Review older browser cart" })); expect(screen.getByRole("region", { name: "Older cart review" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Discard older browser cart" })); expect(localStorage.getItem(LEGACY_CART_KEY)).toBe(raw);
  fireEvent.click(screen.getByRole("button", { name: "Confirm discard older cache" })); await waitFor(() => expect(localStorage.getItem(LEGACY_CART_KEY)).toBeNull());
});
