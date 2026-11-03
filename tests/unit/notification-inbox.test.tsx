/** @jest-environment jsdom */
import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotificationInboxConsole } from "@/components/notifications/notification-inbox";
import { useAuthStore } from "@/stores/auth-store";
const user = { id: "customer", name: "Customer", email: "customer@example.invalid", role: "USER", avatar: null, isVerified: true };
const initial = [{ id: "00000000-0000-4000-8000-000000000001", audience: "ACCOUNT", kind: "ORDER_STATUS", title: "Order status updated", body: "Order status was recorded as processing.", href: "/user/orders", occurredAt: "2026-11-03T01:00:00Z", deliveredAt: "2026-11-03T01:01:00Z", readAt: null, readVersion: 0 }, { id: "00000000-0000-4000-8000-000000000002", audience: "ACCOUNT", kind: "PAYMENT_STATUS", title: "Payment status updated", body: "Payment status was recorded as paid.", href: "/user/orders", occurredAt: "2026-11-03T00:00:00Z", deliveredAt: "2026-11-03T00:01:00Z", readAt: "2026-11-03T00:02:00Z", readVersion: 3 }];
let rows: typeof initial;
const response = (value: unknown, status = 200) => ({ ok: status < 300, status, json: async () => value }) as Response;
function page(url = "/api/notifications", changes = {}) {
  const query = new URL(url, "http://localhost").searchParams, filter = query.get("filter") ?? "ALL", kind = query.get("kind") ?? "ALL", matched = rows.filter((row) => (filter === "ALL" || (filter === "UNREAD" ? row.readAt === null : row.readAt !== null)) && (kind === "ALL" || kind === row.kind));
  return { success: true, ownerId: user.id, ownerRole: user.role, filter, kind, page: Number(query.get("page") ?? 1), total: matched.length, totalPages: 1, totalNotifications: rows.length, unread: rows.filter((row) => row.readAt === null).length, rows: matched, ...changes };
}
async function backend(url: string, init?: RequestInit) {
  if (init?.method === "POST") { const input = JSON.parse(init.body as string), entries = input.action === "read-page" ? input.entries : [{ id: input.id }]; let changed = 0; rows = rows.map((row) => entries.some((entry: { id: string }) => entry.id === row.id) ? (changed++, { ...row, readAt: input.action === "unread" ? null : "2026-11-03T02:00:00Z", readVersion: row.readVersion + 1 }) : row); return response({ success: true, ownerId: user.id, changed }); }
  return response(page(url));
}
const posts = () => (fetch as jest.Mock).mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(init.body));
beforeEach(() => { jest.clearAllMocks(); rows = initial.map((row) => ({ ...row })); useAuthStore.setState({ user, loading: false, fetchUser: jest.fn().mockResolvedValue(user) }); global.fetch = jest.fn().mockImplementation(backend); });
afterEach(() => { jest.useRealTimers(); });
const view = () => render(<StrictMode><NotificationInboxConsole ownerId={user.id} ownerRole="USER" /></StrictMode>);
it("loads once in StrictMode, uses the current viewer and refreshes exact counts after a confirmed read change", async () => {
  view(); fireEvent.click(await screen.findByRole("button", { name: "Mark read: Order status updated" })); await waitFor(() => expect(screen.getByRole("button", { name: "Mark unread: Order status updated" })).toBeTruthy()); expect(posts()[0]).toEqual({ action: "read", id: initial[0].id, version: 0 }); expect(screen.getByText(/0 unread \/ 2 delivered/)).toBeTruthy(); expect((fetch as jest.Mock).mock.calls[0][1].headers["X-Notification-Owner"]).toBe(user.id); expect((fetch as jest.Mock).mock.calls.filter(([, init]) => init.method === "GET")).toHaveLength(2); expect(screen.getAllByRole("link", { name: "View current details" })[0].getAttribute("href")).toBe("/user/orders");
});
it("marks only visible unread messages using their saved revisions", async () => {
  view(); const button = await screen.findByRole("button", { name: "Mark visible unread messages read" }); await waitFor(() => expect(button).toHaveProperty("disabled", false)); fireEvent.click(button); await waitFor(() => expect(posts()).toHaveLength(1)); expect(posts()[0]).toEqual({ action: "read-page", entries: [{ id: initial[0].id, version: 0 }] });
});
it("applies actual read/kind filters without changing the whole-inbox unread count", async () => {
  view(); await screen.findByRole("button", { name: "Mark read: Order status updated" }); fireEvent.change(screen.getByLabelText("Read filter"), { target: { value: "READ" } }); fireEvent.change(screen.getByLabelText("Notification kind"), { target: { value: "PAYMENT_STATUS" } }); fireEvent.click(screen.getByRole("button", { name: "Apply inbox filters" })); await waitFor(() => expect(screen.queryByRole("heading", { name: "Order status updated" })).toBeNull()); expect(screen.getByText(/1 unread \/ 2 delivered/)).toBeTruthy(); expect((fetch as jest.Mock).mock.calls.at(-1)[0]).toContain("filter=READ&kind=PAYMENT_STATUS");
});
it("does not optimistically mark an unconfirmed response as read and retains saved data on a database failure", async () => {
  (fetch as jest.Mock).mockImplementation(async (url, init) => init?.method === "POST" ? response({ success: false, message: "Read change was not confirmed." }, 503) : backend(url, init)); view(); fireEvent.click(await screen.findByRole("button", { name: "Mark read: Order status updated" })); await screen.findByText("Read change was not confirmed."); expect(screen.getByText(/1 unread \/ 2 delivered/)).toBeTruthy(); expect(screen.getByRole("button", { name: "Mark read: Order status updated" })).toHaveProperty("disabled", true); fireEvent.click(screen.getByRole("button", { name: "Refresh saved inbox" })); await waitFor(() => expect(screen.getByRole("button", { name: "Mark read: Order status updated" })).toHaveProperty("disabled", false));
});
it("removes private content after a current-session denial instead of showing the old administrator/customer view", async () => {
  let revoked = false; (fetch as jest.Mock).mockImplementation(async (url, init) => revoked ? response({ success: false, code: "NOTIFICATION_ACCOUNT_CHANGED", message: "Sign in again." }, 403) : backend(url, init)); view(); await screen.findByRole("heading", { name: "Order status updated" }); const before = (useAuthStore.getState().fetchUser as jest.Mock).mock.calls.length; revoked = true; fireEvent.click(screen.getByRole("button", { name: "Refresh saved inbox" })); await screen.findByText("Sign in again."); expect(screen.queryByRole("heading", { name: "Order status updated" })).toBeNull(); expect(useAuthStore.getState().fetchUser).toHaveBeenCalledTimes(before + 1);
});
it("also removes cached private messages when a successful response changes owner role", async () => {
  let changed = false; (fetch as jest.Mock).mockImplementation(async (url) => response(page(url, changed ? { ownerRole: "MEMBER" } : {}))); view(); await screen.findByRole("heading", { name: "Order status updated" }); changed = true; fireEvent.click(screen.getByRole("button", { name: "Refresh saved inbox" })); await screen.findByText(/another account or role/); expect(screen.queryByRole("heading", { name: "Order status updated" })).toBeNull();
});
it("aborts outstanding reads and hides data when the active account changes", async () => {
  let finish!: (value: Response) => void; (fetch as jest.Mock).mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; })); view(); await waitFor(() => expect(finish).toBeDefined()); const signal = (fetch as jest.Mock).mock.calls[0][1].signal; act(() => useAuthStore.setState({ user: null })); expect(signal.aborted).toBe(true); await act(async () => finish(response(page()))); expect(screen.queryByText(/delivered messages in your current role/)).toBeNull();
});
it("polls applied filters while visible and preserves a draft filter that has not been applied", async () => {
  jest.useFakeTimers(); view(); await act(async () => { jest.runAllTicks(); }); await screen.findByRole("heading", { name: "Order status updated" }); fireEvent.change(screen.getByLabelText("Read filter"), { target: { value: "UNREAD" } }); await act(async () => { await jest.advanceTimersByTimeAsync(30_000); }); expect((fetch as jest.Mock).mock.calls.at(-1)[0]).toContain("filter=ALL"); expect(screen.getByLabelText("Read filter")).toHaveProperty("value", "UNREAD"); expect(screen.getByText(/Applied filters: ALL/)).toBeTruthy();
});
it("retains saved messages and reports a clear unavailable state when a proxy response is not JSON", async () => {
  let broken = false; (fetch as jest.Mock).mockImplementation(async (url, init) => broken ? { ok: false, status: 503, json: async () => { throw new Error("private proxy parsing diagnostic"); } } : backend(url, init)); view(); await screen.findByRole("heading", { name: "Order status updated" }); broken = true; fireEvent.click(screen.getByRole("button", { name: "Refresh saved inbox" })); await screen.findByText("The notification response could not be read. Reload the saved inbox."); expect(screen.getByRole("heading", { name: "Order status updated" })).toBeTruthy(); expect(screen.queryByText(/private proxy parsing diagnostic/)).toBeNull();
});
it("keeps a blocked seller's private decision inbox available without administrator recovery controls", async () => {
  const seller = { ...user, id: "seller", role: "MEMBER", sellerStatus: "BLOCKED" }; useAuthStore.setState({ user: seller, fetchUser: jest.fn().mockResolvedValue(seller) }); (fetch as jest.Mock).mockResolvedValue(response(page("/api/notifications", { ownerId: seller.id, ownerRole: "MEMBER" }))); render(<NotificationInboxConsole ownerId={seller.id} ownerRole="MEMBER" />); await screen.findByRole("heading", { name: "Order status updated" }); expect(screen.queryByRole("link", { name: "Delivery queue and recovery" })).toBeNull(); expect(posts()).toHaveLength(0);
});
