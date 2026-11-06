/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { WishlistSync } from "@/components/account/wishlist-sync";
import { useWishlistStore } from "@/stores/wishlist-store";
import { useAuthStore } from "@/stores/auth-store";
import { GUEST_WISHLIST_KEY } from "@/lib/client/wishlist-controller";
const initial = useWishlistStore.getState();
const owner = { id: "owner", name: "Owner", email: "owner@example.invalid", role: "USER", avatar: null, isVerified: true };
const entry = { id: "guest-product", product: { id: "guest-product", slug: "guest-product", name: "Current product", price: 100, discountPrice: 80, stock: 2, imageUrl: null, category: "Phones" } };
const response = (data: unknown) => ({ ok: true, json: async () => data }) as Response;
const snapshot = (ownerId = "owner", items: unknown[] = []) => ({ success: true, ownerId, items, version: 0, page: 1, total: items.length, totalPages: items.length ? 1 : 0 });
beforeEach(() => {
  localStorage.clear(); useWishlistStore.setState(initial, true); useAuthStore.setState({ user: owner, loading: false, fetchUser: jest.fn().mockImplementation(async () => useAuthStore.getState().user) });
  global.fetch = jest.fn().mockImplementation(async (_url, init: RequestInit) => response(snapshot((init.headers as Record<string, string>)["X-Wishlist-Owner"])));
});
afterEach(() => { useWishlistStore.getState().cancel(); jest.useRealTimers(); });
it("offers an explicit guest merge and only sends product IDs after the customer chooses it", async () => {
  localStorage.setItem(GUEST_WISHLIST_KEY, '["guest-product"]'); let merged = false;
  (fetch as jest.Mock).mockImplementation(async (_url, init: RequestInit) => {
    if (init.method === "POST") { merged = true; return response({ success: true, ownerId: "owner", acceptedIds: ["guest-product"], skippedIds: [], version: 1 }); }
    return response(snapshot("owner", merged ? [entry] : []));
  });
  render(<WishlistSync />); const button = await screen.findByRole("button", { name: "Merge guest wishlist into this account" });
  await waitFor(() => expect(button).toHaveProperty("disabled", false)); expect((fetch as jest.Mock).mock.calls.some(([, init]) => init.method === "POST")).toBe(false);
  fireEvent.click(button); await waitFor(() => expect(localStorage.getItem(GUEST_WISHLIST_KEY)).toBe("[]"));
  const [, request] = (fetch as jest.Mock).mock.calls.find(([, init]) => init.method === "POST"); expect(JSON.parse(request.body)).toEqual({ productIds: ["guest-product"], merge: true });
});
it("immediately clears the old account snapshot when auth changes before the new account read finishes", async () => {
  let finish!: (value: Response) => void;
  (fetch as jest.Mock).mockImplementation((_url, init: RequestInit) => (init.headers as Record<string, string>)["X-Wishlist-Owner"] === "owner" ? Promise.resolve(response(snapshot("owner", [entry]))) : new Promise<Response>((resolve) => { finish = resolve; }));
  render(<WishlistSync />); await waitFor(() => expect(useWishlistStore.getState().items).toHaveLength(1));
  act(() => useAuthStore.setState({ user: { ...owner, id: "another-owner" } })); expect(useWishlistStore.getState().items).toEqual([]); expect(useWishlistStore.getState().scope).toBe("account:another-owner");
  await act(async () => finish(response(snapshot("another-owner", [])))); expect(useWishlistStore.getState().items).toEqual([]);
});
it("revalidates on focus and the visible-tab schedule, then removes its timers on unmount", async () => {
  jest.useFakeTimers(); let view!: ReturnType<typeof render>;
  const intervals = jest.spyOn(global, "setInterval"), cleared = jest.spyOn(global, "clearInterval");
  await act(async () => { view = render(<WishlistSync />); }); expect(useWishlistStore.getState().status).toBe("ready"); const before = (fetch as jest.Mock).mock.calls.length;
  await act(async () => fireEvent.focus(window)); expect((fetch as jest.Mock).mock.calls.length).toBeGreaterThan(before);
  const reads = (fetch as jest.Mock).mock.calls.length;
  await act(async () => jest.advanceTimersByTime(30_000)); expect((fetch as jest.Mock).mock.calls.length).toBeGreaterThan(reads);
  const index = intervals.mock.calls.findIndex(([, delay]) => delay === 30_000); expect(index).toBeGreaterThanOrEqual(0);
  view.unmount(); expect(cleared).toHaveBeenCalledWith(intervals.mock.results[index].value);
  const stopped = (fetch as jest.Mock).mock.calls.length; await act(async () => jest.advanceTimersByTime(60_000)); expect((fetch as jest.Mock).mock.calls.length).toBe(stopped);
  intervals.mockRestore(); cleared.mockRestore();
});
it("recovers its initial read through Strict Mode effect cleanup and remount", async () => {
  render(<StrictMode><WishlistSync /></StrictMode>); await waitFor(() => expect(useWishlistStore.getState().status).toBe("ready")); expect(useWishlistStore.getState().busy).toBe(false);
});
