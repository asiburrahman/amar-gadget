/** @jest-environment jsdom */
import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CouponConsole } from "@/components/admin/coupon-console";
import { useAuthStore } from "@/stores/auth-store";
const admin = { id: "admin", name: "Admin", email: "admin@example.invalid", role: "ADMIN", avatar: null, isVerified: true };
const row = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", code: "SAVED", version: 1, discount: 12.5, isPercentage: true, minSpend: 100, expiresAt: "2028-11-01T12:00:00.123Z", isActive: true, status: "ACTIVE", usedOrders: 0, createdAt: "2026-11-02T00:00:00.000Z", updatedAt: "2026-11-02T00:00:00.000Z" };
const page = () => ({ success: true, ownerId: admin.id, rows: [row], events: [], total: 1, page: 1, totalPages: 1, attempt: null, attemptedRow: null });
const response = (value: unknown, status = 200) => ({ ok: status < 300, status, json: async () => value }) as Response;
const posts = () => (fetch as jest.Mock).mock.calls.filter(([, value]) => value.method === "POST").map(([, value]) => JSON.parse(value.body));
beforeEach(() => { jest.clearAllMocks(); useAuthStore.setState({ user: admin, loading: false, fetchUser: jest.fn().mockResolvedValue(admin) }); global.fetch = jest.fn().mockResolvedValue(response(page())); });
it("loads once in StrictMode and preserves exact UTC expiry and observed revision when editing", async () => {
  (fetch as jest.Mock).mockImplementation(async (_url, init) => response(init.method === "POST" ? { success: true, ownerId: admin.id, kind: "saved", row: { ...row, version: 2 } } : page()));
  render(<StrictMode><CouponConsole ownerId={admin.id} /></StrictMode>);
  fireEvent.click(await screen.findByRole("button", { name: "Edit" })); expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText("Discount"), { target: { value: "15.75" } }); fireEvent.click(screen.getByRole("button", { name: "Save current revision" }));
  await waitFor(() => expect(posts()).toHaveLength(1)); expect(posts()[0]).toEqual({ action: "update", requestId: expect.any(String), id: row.id, version: 1, fields: { code: "SAVED", discount: 15.75, isPercentage: true, minSpend: 100, expiresAt: row.expiresAt, isActive: true } });
  await screen.findByRole("heading", { name: "Edit SAVED (revision 2)" });
});
it("keeps uncertain intent and retries the identical body only after reading an absent receipt", async () => {
  let writes = 0;
  (fetch as jest.Mock).mockImplementation(async (_url, init) => { if (init.method === "GET") return response(page()); if (++writes === 1) throw new Error("Response lost"); return response({ success: true, ownerId: admin.id, kind: "saved", row: { ...row, version: 2 } }); });
  render(<CouponConsole ownerId={admin.id} />); fireEvent.click(await screen.findByRole("button", { name: "Edit" })); fireEvent.change(screen.getByLabelText("Discount"), { target: { value: "18" } }); fireEvent.click(screen.getByRole("button", { name: "Save current revision" })); await screen.findByText("Response lost");
  expect(screen.getByLabelText("Discount")).toHaveProperty("value", "18"); expect(screen.getByRole("button", { name: "Retry original request" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "Reload saved coupons / receipt" })); await waitFor(() => expect(screen.getByRole("button", { name: "Retry original request" })).toHaveProperty("disabled", false)); fireEvent.click(screen.getByRole("button", { name: "Retry original request" }));
  await waitFor(() => expect(posts()).toHaveLength(2)); expect(posts()[1]).toEqual(posts()[0]);
});
it("recovers a committed request from its current saved row without a second write", async () => {
  let recorded = false;
  (fetch as jest.Mock).mockImplementation(async (url, init) => { if (init.method === "POST") { recorded = true; throw new Error("Receipt lost"); } return response({ ...page(), ...(recorded && String(url).includes("requestId=") ? { attempt: { id: row.id, version: 2 }, attemptedRow: { ...row, version: 3, isActive: false } } : {}) }); });
  render(<CouponConsole ownerId={admin.id} />); fireEvent.click(await screen.findByRole("button", { name: "Edit" })); fireEvent.click(screen.getByRole("button", { name: "Save current revision" })); await screen.findByText("Receipt lost"); fireEvent.click(screen.getByRole("button", { name: "Reload saved coupons / receipt" }));
  await screen.findByText("The original request is recorded. Current saved coupon loaded."); expect(posts()).toHaveLength(1); expect(screen.getByRole("heading", { name: "Edit SAVED (revision 3)" })).toBeTruthy(); expect(screen.queryByRole("button", { name: "Retry original request" })).toBeNull();
});
it("uses a real read-only draft preview, invalidates it on changes and exposes qualification errors", async () => {
  let qualify = true;
  (fetch as jest.Mock).mockImplementation(async (_url, init) => init.method === "GET" ? response(page()) : qualify ? response({ success: true, ownerId: admin.id, kind: "preview", totals: { subtotal: 100, discountAmount: 12.5, shippingFee: 150, total: 237.5 }, evaluatedAt: row.createdAt }) : response({ success: false, message: "Minimum spend not met" }, 422));
  render(<CouponConsole ownerId={admin.id} />); fireEvent.click(await screen.findByRole("button", { name: "Edit" })); fireEvent.change(screen.getByLabelText("Subtotal (BDT)"), { target: { value: "100" } }); fireEvent.click(screen.getByRole("button", { name: "Calculate preview" }));
  await screen.findByText(/BDT subtotal 100.00/); expect(posts()[0]).toMatchObject({ action: "preview", target: { id: row.id, version: 1 }, subtotal: 100 });
  fireEvent.change(screen.getByLabelText("Discount"), { target: { value: "20" } }); expect(screen.queryByText(/BDT subtotal 100.00/)).toBeNull(); qualify = false; fireEvent.click(screen.getByRole("button", { name: "Calculate preview" })); await screen.findByText("Minimum spend not met"); expect(screen.queryByRole("button", { name: "Retry original request" })).toBeNull();
});
it("does not rebase typed drafts on a list reload and sends explicit revision-bound deactivation", async () => {
  (fetch as jest.Mock).mockImplementation(async (_url, init) => response(init.method === "POST" ? { success: true, ownerId: admin.id, kind: "saved", row: { ...row, version: 2, isActive: false } } : page()));
  render(<CouponConsole ownerId={admin.id} />); fireEvent.click(await screen.findByRole("button", { name: "Edit" })); fireEvent.change(screen.getByLabelText("Code"), { target: { value: "TYPED" } }); fireEvent.click(screen.getByRole("button", { name: "Reload saved coupons / receipt" })); await waitFor(() => expect(screen.getByRole("button", { name: "Deactivate saved coupon" })).toHaveProperty("disabled", false)); expect(screen.getByLabelText("Code")).toHaveProperty("value", "TYPED");
  fireEvent.click(screen.getByRole("button", { name: "Deactivate saved coupon" })); await waitFor(() => expect(posts()).toHaveLength(1)); expect(posts()[0]).toEqual({ action: "activation", requestId: expect.any(String), id: row.id, version: 1, isActive: false });
});
it("aborts prior-account requests and ignores a late response after switching accounts", async () => {
  let finish!: (value: Response) => void;
  (fetch as jest.Mock).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<CouponConsole ownerId={admin.id} />); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1)); const signal = (fetch as jest.Mock).mock.calls[0][1].signal;
  act(() => useAuthStore.setState({ user: null })); expect(signal.aborted).toBe(true); await act(async () => finish(response(page()))); expect(screen.queryByLabelText("Code")).toBeNull();
});
