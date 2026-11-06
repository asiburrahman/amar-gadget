/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useAuthStore } from "@/stores/auth-store";
import { currentCartScope } from "@/stores/cart-store";
import { currentWishlistScope } from "@/stores/wishlist-store";
import { AuthServiceNotice } from "@/components/account/auth-service-notice";
const refresh = useAuthStore.getState().fetchUser;
const buyer = { id: "buyer", name: "Buyer", email: "buyer@example.invalid", role: "USER", isVerified: true, avatar: null };
const reply = (value: unknown, status = 200) => ({ ok: status < 300, status, json: async () => value }) as Response;
beforeEach(() => { useAuthStore.setState({ user: buyer, loading: false, error: null, reference: null, fetchUser: refresh }); global.fetch = jest.fn(); });
it("hides cached private data and locks account scopes during an outage, then recovers through the visible retry", async () => {
  const reference = "fb13b340-261c-4b42-a3b8-f50a6009f0ee";
  (fetch as jest.Mock).mockResolvedValueOnce(reply({ success: false, reference, message: "private SQL" }, 503)).mockResolvedValueOnce(reply({ success: true, user: buyer }));
  render(<AuthServiceNotice />); await act(async () => { await refresh(); });
  expect(screen.getByRole("alert").textContent).toContain(reference); expect(screen.queryByText(/private SQL/)).toBeNull();
  expect(useAuthStore.getState().user).toBeNull(); expect(currentCartScope()).toBe("loading"); expect(currentWishlistScope()).toBe("loading");
  fireEvent.click(screen.getByRole("button", { name: "Retry session verification" }));
  await waitFor(() => expect(useAuthStore.getState().user?.id).toBe(buyer.id)); expect(screen.queryByRole("alert")).toBeNull(); expect(useAuthStore.getState().loading).toBe(false);
});
it("enters the guest scope only after an explicit successful signed-out response", async () => {
  (fetch as jest.Mock).mockResolvedValue(reply({ success: false, user: null })); await refresh();
  expect(useAuthStore.getState()).toMatchObject({ user: null, loading: false, error: null }); expect(currentCartScope()).toBe("guest");
});
it.each([reply({ success: true, user: buyer }, 500), reply({ success: false }), reply({ success: true, user: { ...buyer, isVerified: false } })])("does not accept an ambiguous/malformed response as verified or signed out", async (response) => {
  (fetch as jest.Mock).mockResolvedValue(response); await refresh(); expect(useAuthStore.getState()).toMatchObject({ user: null, loading: true }); expect(useAuthStore.getState().error).toBeTruthy();
});
it("ignores a late failed check after the user switched accounts", async () => {
  let finish!: (value: Response) => void; (fetch as jest.Mock).mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
  const pending = refresh(); useAuthStore.getState().setUser({ ...buyer, id: "another" }); finish(reply({ success: false }, 503)); await pending;
  expect(useAuthStore.getState()).toMatchObject({ user: { id: "another" }, error: null, loading: false });
});
it("turns a bounded network timeout into a retryable unknown-session state", async () => {
  jest.useFakeTimers();
  try {
    (fetch as jest.Mock).mockImplementation((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(Error("timeout")))));
    const pending = refresh(); await jest.advanceTimersByTimeAsync(15_000); await pending;
    expect(useAuthStore.getState()).toMatchObject({ user: null, loading: true }); expect(useAuthStore.getState().error).toBeTruthy();
  } finally { jest.useRealTimers(); }
});
