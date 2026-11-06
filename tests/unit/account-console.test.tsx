/** @jest-environment jsdom */
import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AccountConsole } from "@/components/admin/account-console";
import { useAuthStore } from "@/stores/auth-store";
const mockReplace = jest.fn(), mockRefresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace: mockReplace, refresh: mockRefresh }) }));
const admin = { id: "admin", name: "Admin", email: "admin@example.invalid", role: "ADMIN", avatar: null, isVerified: true };
const row = { id: "seller", email: "seller@example.invalid", name: "Actual seller", role: "MEMBER", sellerStatus: "PENDING", isVerified: true, administrationVersion: 1, createdAt: "2026-11-02T00:00:00.000Z", _count: { products: 2, orders: 5, vendorFulfillments: 3 } };
const page = (scope = "members") => ({ success: true, ownerId: admin.id, scope, rows: [row], events: [], page: 1, total: 1, totalPages: 1, attempt: null, attemptedRow: null });
const response = (value: unknown, status = 200) => ({ ok: status < 300, status, json: async () => value }) as Response;
const saved = (self = false) => ({ success: true, ownerId: admin.id, result: { id: row.id, version: 2, sessionChanged: self }, row: { ...row, administrationVersion: 2, sellerStatus: "APPROVED" } });
const posts = () => (fetch as jest.Mock).mock.calls.filter(([, value]) => value.method === "POST").map(([, value]) => JSON.parse(value.body));
beforeEach(() => { jest.clearAllMocks(); useAuthStore.setState({ user: admin, loading: false, fetchUser: jest.fn().mockResolvedValue(admin) }); global.fetch = jest.fn().mockImplementation(async (_url, init) => response(init.method === "POST" ? saved() : page())); });
const approve = async () => { fireEvent.click(await screen.findByRole("button", { name: `Manage ${row.email}` })); fireEvent.change(screen.getByLabelText("New seller status"), { target: { value: "APPROVED" } }); fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Verified seller onboarding completed" } }); fireEvent.click(screen.getByRole("checkbox", { name: /I confirm this action/ })); };
it("loads once in StrictMode and submits an explicit reason/affirmation with the observed seller revision", async () => {
  render(<StrictMode><AccountConsole ownerId={admin.id} scope="members" /></StrictMode>); await approve(); expect(fetch).toHaveBeenCalledTimes(1); fireEvent.click(screen.getByRole("button", { name: "Confirm account action" }));
  await waitFor(() => expect(posts()).toHaveLength(1)); expect(posts()[0]).toEqual({ action: "seller-status", id: row.id, version: 1, requestId: expect.any(String), sellerStatus: "APPROVED", reason: "Verified seller onboarding completed", confirmed: true }); expect((fetch as jest.Mock).mock.calls[1][1].headers["X-Account-Owner"]).toBe(admin.id);
});
it("invalidates affirmation when the selected operation/reason changes and never submits an unconfirmed action", async () => {
  render(<AccountConsole ownerId={admin.id} scope="members" />); await approve(); const submit = screen.getByRole("button", { name: "Confirm account action" }); expect(submit).toHaveProperty("disabled", false);
  fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Updated review reason" } }); expect(submit).toHaveProperty("disabled", true); fireEvent.click(submit); expect(posts()).toHaveLength(0);
  fireEvent.click(screen.getByRole("checkbox", { name: /I confirm this action/ })); fireEvent.change(screen.getByLabelText("Account action"), { target: { value: "revoke-sessions" } }); expect(submit).toHaveProperty("disabled", true);
});
it("retains uncertain intent and retries exactly the same request only after reading its absent receipt", async () => {
  let writes = 0; (fetch as jest.Mock).mockImplementation(async (_url, init) => { if (init.method === "GET") return response(page()); if (++writes === 1) throw new Error("Response lost"); return response(saved()); });
  render(<AccountConsole ownerId={admin.id} scope="members" />); await approve(); fireEvent.click(screen.getByRole("button", { name: "Confirm account action" })); await screen.findByText("Response lost"); expect(screen.getByLabelText("Reason")).toHaveProperty("value", "Verified seller onboarding completed"); expect(screen.getByRole("button", { name: "Retry original request" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "Reload saved accounts / receipt" })); await waitFor(() => expect(screen.getByRole("button", { name: "Retry original request" })).toHaveProperty("disabled", false)); fireEvent.click(screen.getByRole("button", { name: "Retry original request" })); await waitFor(() => expect(posts()).toHaveLength(2)); expect(posts()[1]).toEqual(posts()[0]);
});
it("recovers a recorded original action using current account state without a second mutation", async () => {
  let recorded = false; (fetch as jest.Mock).mockImplementation(async (url, init) => { if (init.method === "POST") { recorded = true; throw new Error("Receipt lost"); } return response({ ...page(), ...(recorded && String(url).includes("requestId=") ? { attempt: { id: row.id, version: 2, sessionChanged: false }, attemptedRow: { ...row, administrationVersion: 3, sellerStatus: "BLOCKED" } } : {}) }); });
  render(<AccountConsole ownerId={admin.id} scope="members" />); await approve(); fireEvent.click(screen.getByRole("button", { name: "Confirm account action" })); await screen.findByText("Receipt lost"); fireEvent.click(screen.getByRole("button", { name: "Reload saved accounts / receipt" })); await screen.findByText("The original change is recorded. Current account state loaded."); expect(posts()).toHaveLength(1); expect(screen.getByRole("heading", { name: /revision 3/ })).toBeTruthy(); expect(screen.getByLabelText("New seller status")).toHaveProperty("value", "BLOCKED");
});
it("clears local authorization and sends the administrator to sign in after a confirmed own-session change", async () => {
  (fetch as jest.Mock).mockImplementation(async (_url, init) => response(init.method === "POST" ? saved(true) : { ...page("accounts"), rows: [{ ...row, id: admin.id, email: admin.email, role: "ADMIN" }] }));
  render(<AccountConsole ownerId={admin.id} scope="accounts" />); fireEvent.click(await screen.findByRole("button", { name: `Manage ${admin.email}` })); fireEvent.change(screen.getByLabelText("Account action"), { target: { value: "revoke-sessions" } }); fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Revoke my copied sessions" } }); fireEvent.click(screen.getByRole("checkbox", { name: /I confirm this action/ })); fireEvent.click(screen.getByRole("button", { name: "Confirm account action" }));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/login")); expect(useAuthStore.getState().user).toBeNull();
});
it("aborts old-account requests and does not display a late directory response", async () => {
  let finish!: (value: Response) => void; (fetch as jest.Mock).mockImplementation(() => new Promise((resolve) => { finish = resolve; })); render(<AccountConsole ownerId={admin.id} scope="members" />); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1)); const signal = (fetch as jest.Mock).mock.calls[0][1].signal;
  act(() => useAuthStore.setState({ user: null })); expect(signal.aborted).toBe(true); await act(async () => finish(response(page()))); expect(screen.queryByText(row.email)).toBeNull();
});
it("does not silently replace a typed reason or approval choice when reloading a list", async () => {
  render(<AccountConsole ownerId={admin.id} scope="members" />); await approve(); fireEvent.click(screen.getByRole("button", { name: "Reload saved accounts / receipt" })); await waitFor(() => expect(screen.getByRole("button", { name: "Confirm account action" })).toHaveProperty("disabled", false)); expect(screen.getByLabelText("Reason")).toHaveProperty("value", "Verified seller onboarding completed"); expect(screen.getByLabelText("New seller status")).toHaveProperty("value", "APPROVED");
});
it("explains an invalid audit reason without creating an uncertain write or losing the draft", async () => {
  render(<AccountConsole ownerId={admin.id} scope="members" />); await approve(); fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Reviewed\nsecond line" } }); fireEvent.click(screen.getByRole("checkbox", { name: /I confirm this action/ })); fireEvent.click(screen.getByRole("button", { name: "Confirm account action" })); await screen.findByText("Use a single line of plain text for the audit reason."); expect(posts()).toHaveLength(0); expect(screen.queryByRole("button", { name: "Retry original request" })).toBeNull(); expect(screen.getByLabelText("Reason")).toHaveProperty("value", "Reviewed\nsecond line");
});
