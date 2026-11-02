/** @jest-environment jsdom */
import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReportConsole, reportMoney } from "@/components/admin/report-console";
import { useAuthStore } from "@/stores/auth-store";
const admin = { id: "admin", name: "Admin", email: "admin@example.invalid", role: "ADMIN", avatar: null, isVerified: true };
const report = { success: true, ownerId: admin.id, filters: { from: "2026-11-01", to: "2026-11-02", status: "ALL", paymentStatus: "ALL", paymentMethod: "ALL", page: 1, format: "json" }, timezone: "Asia/Dhaka", asOf: "2026-11-02T00:00:00.000Z", page: 1, totalPages: 2,
  summary: { orders: 21, grossOrderCents: 210000, paidCaptureCents: 100000, paidRefundCents: 10000, lostDisputeCents: 5000, netFullyCollectedCents: 85000, partiallyCollectedCodOrders: 1, reviewOrders: 1 },
  rows: [{ id: "order-one", userId: "buyer", createdAt: "2026-11-02T00:00:00Z", status: "PROCESSING", paymentMethod: "COD", paymentStatus: "UNPAID", totalCents: 10000, refundedCents: 0, lostDisputeCents: 0, netCents: null, collectedShipments: 1, review: false }], daily: [] };
const response = (value: unknown, status = 200) => ({ ok: status < 300, status, json: async () => value }) as Response;
beforeEach(() => { jest.clearAllMocks(); useAuthStore.setState({ user: admin, loading: false, fetchUser: jest.fn().mockResolvedValue(admin) }); global.fetch = jest.fn().mockResolvedValue(response(report)); });
it("loads once in StrictMode, displays actual report definitions and distinguishes partially collected orders", async () => {
  render(<StrictMode><ReportConsole ownerId={admin.id} /></StrictMode>); await screen.findByText("order-one"); expect(fetch).toHaveBeenCalledTimes(1); expect(screen.getByText("Not fully paid")).toBeTruthy(); expect(screen.getByText("Partially collected COD orders")).toBeTruthy(); expect(screen.getByLabelText("From (Dhaka date)")).toHaveProperty("value", report.filters.from); expect((fetch as jest.Mock).mock.calls[0][1].headers["X-Reports-Owner"]).toBe(admin.id);
});
it("applies draft filters explicitly and disables export while displayed rows still use earlier filters", async () => {
  (fetch as jest.Mock).mockImplementation(async (url) => { const params = new URL(String(url), "http://localhost").searchParams; return response({ ...report, filters: { ...report.filters, paymentMethod: params.get("paymentMethod") }, rows: params.get("paymentMethod") === "STRIPE" ? [] : report.rows }); });
  render(<ReportConsole ownerId={admin.id} />); await screen.findByText("order-one"); fireEvent.change(screen.getByLabelText("Payment method"), { target: { value: "STRIPE" } }); expect(screen.getByRole("button", { name: "Export displayed filters as CSV" })).toHaveProperty("disabled", true); expect(screen.getByText("order-one")).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: "Apply report filters" })); await screen.findByText("No orders match these filters."); expect((fetch as jest.Mock).mock.calls[1][0]).toContain("paymentMethod=STRIPE");
});
it("exports every match using page one and the applied filters rather than the visible page", async () => {
  URL.createObjectURL = jest.fn().mockReturnValue("blob:report"); URL.revokeObjectURL = jest.fn(); const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  (fetch as jest.Mock).mockImplementation(async (url) => { const params = new URL(String(url), "http://localhost").searchParams; if (params.get("format") === "csv") return { ok: true, headers: new Headers({ "Content-Type": "text/csv; charset=utf-8" }), blob: async () => new Blob(["actual,csv\r\n"]) }; return response({ ...report, page: Number(params.get("page")), filters: { ...report.filters, page: Number(params.get("page")) } }); });
  try {
    render(<ReportConsole ownerId={admin.id} />); await screen.findByText("order-one"); fireEvent.click(screen.getByRole("button", { name: "Next report page" })); await screen.findByText("Page 2 / 2"); fireEvent.click(screen.getByRole("button", { name: "Export displayed filters as CSV" })); await waitFor(() => expect(click).toHaveBeenCalledTimes(1)); const request = (fetch as jest.Mock).mock.calls.find(([url]) => String(url).includes("format=csv"))[0]; expect(request).toContain("page=1"); expect(request).toContain("from=2026-11-01"); expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  } finally { click.mockRestore(); }
});
it("keeps the previous confirmed report when an oversized export fails and never downloads a partial file", async () => {
  URL.createObjectURL = jest.fn(); (fetch as jest.Mock).mockImplementation(async (url) => String(url).includes("format=csv") ? response({ message: "Narrow filters: export exceeds 5000" }, 422) : response(report));
  render(<ReportConsole ownerId={admin.id} />); await screen.findByText("order-one"); fireEvent.click(screen.getByRole("button", { name: "Export displayed filters as CSV" })); await screen.findByText("Narrow filters: export exceeds 5000"); expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(screen.getByText("order-one")).toBeTruthy();
});
it("aborts old-account reads and does not expose a late report after switching accounts", async () => {
  let finish!: (value: Response) => void; (fetch as jest.Mock).mockImplementation(() => new Promise((resolve) => { finish = resolve; })); render(<ReportConsole ownerId={admin.id} />); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1)); const signal = (fetch as jest.Mock).mock.calls[0][1].signal;
  act(() => useAuthStore.setState({ user: null })); expect(signal.aborted).toBe(true); await act(async () => finish(response(report))); expect(screen.queryByText("order-one")).toBeNull();
});
it("shows a real loading failure without substituting fabricated zero totals", async () => {
  (fetch as jest.Mock).mockResolvedValue(response({ message: "Reports temporarily unavailable" }, 503)); render(<ReportConsole ownerId={admin.id} />); await screen.findByText("Reports temporarily unavailable"); expect(screen.queryByText("Orders placed")).toBeNull(); expect(screen.queryByText("No orders match these filters.")).toBeNull();
});
it("formats exact supported integer cents without losing the final paisa", () => { expect(reportMoney(Number.MAX_SAFE_INTEGER).replaceAll(",", "")).toBe("BDT 90071992547409.91"); });
