/** @jest-environment jsdom */
import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RefundConsole } from "@/components/orders/refund-console";
import { useAuthStore } from "@/stores/auth-store";
const mockRefresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
const admin = { id: "admin", name: "Admin", email: "admin@example.invalid", role: "ADMIN", isVerified: true, avatar: null };
const orderId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", itemId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const page = () => ({ success: true, ownerId: useAuthStore.getState().user!.id, page: 1, total: 0, totalPages: 1, attempt: null, disputes: [], history: [], nextCursor: null,
  order: { id: orderId, version: 7, totalCents: 12000, refundedCents: 0, shippingRefundedCents: 0, refundState: "NONE", disputeStatus: "NONE", paymentMethod: "STRIPE", paymentStatus: "PAID", pricing: { subtotalCents: 10000, discountCents: 0, shippingCents: 2000 } },
  items: [{ id: itemId, name: "Purchased gadget", quantity: 2, refundedQuantity: 0, returnedQuantity: 0, voidedQuantity: 0, version: 3, netCents: 10000, refundedCents: 0, status: "PROCESSING" }], refunds: [] as Record<string, unknown>[] });
const response = (value: unknown, status = 200) => ({ ok: status < 300, status, json: async () => value }) as Response;
const writes = () => (fetch as jest.Mock).mock.calls.filter(([, init]) => init.method === "POST").map(([, init]) => JSON.parse(init.body));
const quote = () => ({ success: true, ownerId: admin.id, orderId, version: 7, quote: { amountCents: 6000, shippingCents: 1000, lines: [{ itemId, quantity: 1, amountCents: 5000, beforeDispatch: true }] } });
beforeEach(() => {
  jest.clearAllMocks(); useAuthStore.setState({ user: admin, loading: false, fetchUser: jest.fn().mockResolvedValue(admin) });
  global.fetch = jest.fn().mockResolvedValue(response(page()));
});
it("loads once in StrictMode, uses the server preview and submits only quantity, identity, reason and revision", async () => {
  (fetch as jest.Mock).mockImplementation(async (_url, init) => init.method === "GET" ? response(page()) : response(JSON.parse(init.body).action === "quote" ? quote() : { success: true, ownerId: admin.id, orderId }));
  render(<StrictMode><RefundConsole orderId={orderId} admin /></StrictMode>);
  fireEvent.change(await screen.findByLabelText("Refund scope"), { target: { value: "ITEMS" } }); expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText("Refund quantity for Purchased gadget"), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("Refund reason"), { target: { value: "Customer confirmed the return" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview refund amount" })); fireEvent.click(await screen.findByRole("button", { name: "Request the previewed refund" }));
  await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  expect(writes()[1]).toEqual({ action: "request", request: { orderId, version: 7, requestId: expect.any(String), reason: "Customer confirmed the return", selection: [{ itemId, quantity: 1 }] } });
  expect(screen.getByLabelText("Refund reason")).toHaveProperty("value", "");
});
it("preserves uncertain request details and retries the original UUID only after a confirmed reload", async () => {
  let attempts = 0;
  (fetch as jest.Mock).mockImplementation(async (_url, init) => {
    if (init.method === "GET") return response(page());
    const body = JSON.parse(init.body); if (body.action === "quote") return response(quote());
    attempts++; if (attempts === 1) throw new Error("Response lost after submission");
    return response({ success: true, ownerId: admin.id, orderId });
  });
  render(<RefundConsole orderId={orderId} admin />);
  fireEvent.change(await screen.findByLabelText("Refund reason"), { target: { value: "Keep the original reason" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview refund amount" })); fireEvent.click(await screen.findByRole("button", { name: "Request the previewed refund" }));
  await screen.findByText("Response lost after submission"); expect(screen.getByLabelText("Refund reason")).toHaveProperty("value", "Keep the original reason");
  expect(screen.getByRole("button", { name: "Retry the original attempt" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "Reload saved financial state" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Retry the original attempt" })).toHaveProperty("disabled", false));
  fireEvent.click(screen.getByRole("button", { name: "Retry the original attempt" })); await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  expect(writes()[2]).toEqual(writes()[1]);
});
it("finds a saved original receipt after response loss without resubmitting the request", async () => {
  let original: Record<string, unknown> | null = null;
  (fetch as jest.Mock).mockImplementation(async (url, init) => {
    if (init.method === "GET") { const value = page(); return response(original && String(url).includes("requestId=") ? { ...value, attempt: { refund: { id: "recorded" }, returned: null } } : value); }
    const body = JSON.parse(init.body); if (body.action === "quote") return response(quote()); original = body; throw new Error("Uncertain response");
  });
  render(<RefundConsole orderId={orderId} admin />); fireEvent.change(await screen.findByLabelText("Refund reason"), { target: { value: "Original saved reason" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview refund amount" })); fireEvent.click(await screen.findByRole("button", { name: "Request the previewed refund" })); await screen.findByText("Uncertain response");
  fireEvent.click(screen.getByRole("button", { name: "Reload saved financial state" })); await screen.findByText("The original attempt is already recorded in the saved history.");
  expect(writes()).toHaveLength(2); expect(screen.queryByRole("button", { name: "Retry the original attempt" })).toBeNull(); expect(screen.getByLabelText("Refund reason")).toHaveProperty("value", "");
});
it("requires actual COD repayment evidence and clears its affirmation when the reference changes", async () => {
  const value = page(); value.refunds = [{ id: "cod", version: 9, kind: "ITEMS", status: "QUEUED", paymentMethod: "COD", amountCents: 5000, shippingCents: 0, lines: [], createdAt: "2026-10-30T00:00:00Z" }];
  (fetch as jest.Mock).mockImplementation(async (_url, init) => response(init.method === "GET" ? value : { success: true, ownerId: admin.id, orderId }));
  render(<RefundConsole orderId={orderId} admin />);
  const button = await screen.findByRole("button", { name: "Record external COD repayment" }); expect(button).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByLabelText("Transaction/receipt reference for cod"), { target: { value: "BANK-REAL-123" } });
  const checkbox = screen.getByRole("checkbox", { name: /actually returned/ }); fireEvent.click(checkbox); expect(button).toHaveProperty("disabled", false);
  fireEvent.change(screen.getByLabelText("Transaction/receipt reference for cod"), { target: { value: "BANK-REAL-124" } }); expect(checkbox).toHaveProperty("checked", false);
  fireEvent.click(checkbox); fireEvent.click(button); await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  expect(writes()).toEqual([{ action: "confirm-cod", refundId: "cod", version: 9, moneyReturned: true, method: "BKASH", reference: "BANK-REAL-124" }]);
});
it("aborts a prior account's request and ignores its late financial response", async () => {
  let finish!: (value: Response) => void;
  (fetch as jest.Mock).mockImplementation((_url, init) => init.method === "GET" ? Promise.resolve(response(page())) : new Promise<Response>((resolve) => { finish = resolve; }));
  render(<RefundConsole orderId={orderId} admin />); fireEvent.click(await screen.findByRole("button", { name: "Preview refund amount" }));
  const init = (fetch as jest.Mock).mock.calls.find(([, value]) => value.method === "POST")[1]; act(() => useAuthStore.setState({ user: null })); expect(init.signal.aborted).toBe(true);
  await act(async () => finish(response(quote()))); expect(screen.queryByRole("button", { name: "Request the previewed refund" })).toBeNull(); expect(mockRefresh).not.toHaveBeenCalled();
});
it("exposes financial history to customers without administrator mutation controls", async () => {
  useAuthStore.setState({ user: { ...admin, id: "buyer", role: "USER" } }); (fetch as jest.Mock).mockResolvedValue(response(page()));
  render(<RefundConsole orderId={orderId} />); await screen.findByText("No refund has been recorded for this order.");
  expect(screen.queryByLabelText("Refund scope")).toBeNull(); expect(screen.queryByRole("button", { name: "Preview refund amount" })).toBeNull();
  expect((fetch as jest.Mock).mock.calls[0][0]).toContain("/api/user/refunds");
});
