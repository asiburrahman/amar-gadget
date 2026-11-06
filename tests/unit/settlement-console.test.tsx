/** @jest-environment jsdom */
import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SettlementConsole } from "@/components/settlements/settlement-console";
import { useAuthStore } from "@/stores/auth-store";
const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const admin = { id: "admin", name: "Admin", email: "admin@example.invalid", role: "ADMIN", avatar: null, isVerified: true };
const seller = { id: "seller", name: "Seller", email: "seller@example.invalid", role: "MEMBER", sellerStatus: "APPROVED", avatar: null, isVerified: true };
const policy = { id: "policy", scopeKey: "GLOBAL", version: 3, commissionBps: 1250, shippingRecipient: "PLATFORM", createdById: admin.id, reason: "Actual configured terms", createdAt: "2026-11-03T00:00:00Z" };
const payout = { id: "payout", sellerId: seller.id, amountCents: "5000", method: "BANK", status: "RESERVED", version: 1, createdById: admin.id, reason: "Reviewed available balance", reference: null, resolvedById: null, resolutionReason: null, moneyNotSent: null, resolvedAt: null, createdAt: "2026-11-03T00:00:00Z" };
const shipment = { fulfillmentId: "shipment", orderId: "order", sellerId: seller.id, version: 4, snapshotVersion: 1, policyId: null, capturedCommissionBps: null, capturedShippingRecipient: null, origin: "LEGACY_UNCONFIGURED", capturedAt: "2026-11-03T00:00:00Z", adoptedAt: null, status: "DELIVERED", codCollected: true, paymentMethod: "COD", paymentStatus: "PAID", effectivePolicyId: policy.id, effectiveCommissionBps: policy.commissionBps, effectiveShippingRecipient: policy.shippingRecipient, unallocatedDisputeLossCents: "0", projection: { goodsCents: "10000", shippingCents: "1500", commissionCents: "0", disputeLossCents: "0", availableCents: "0", holds: ["POLICY_REQUIRED"] } };
const response = (value: unknown, status = 200) => ({ ok: status < 300, status, json: async () => value }) as Response;
function page(mode = "overview", changes = {}) {
  return { success: true, ownerId: admin.id, ownerRole: "ADMIN", seller: null, scopeKey: "GLOBAL", currentPolicy: policy, globalPolicy: policy, effectivePolicy: policy,
    summary: { balanceCents: "10500", payableCents: "10500", receivableCents: "0", reservedCents: "0", paidCents: "0", entitlementCents: "10500", potentialCents: "10500", heldShipments: "0", unconfiguredShipments: "0" },
    mode, page: 1, total: 1, totalPages: 1, attempt: null, rows: mode === "policies" ? [policy] : mode === "payouts" ? [payout] : mode === "shipments" ? [shipment] : mode === "ledger" ? [] : [{ ...seller, balanceCents: "10500" }], monthly: [{ month: "2026-11", entitlementChangeCents: "10500", reservationChangeCents: "0", paidCents: "0" }], ...changes };
}
const posts = () => (fetch as jest.Mock).mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(init.body));
const key = `amar:settlement-intent:${admin.id}`;
const intent = { requestId: "00000000-0000-4000-8000-000000000001", reason: "Reviewed exact payout amount", confirmed: true, action: "start-payout", sellerId: seller.id, amountCents: "1000", method: "BANK" };
async function defaultFetch(url: string, init?: RequestInit) {
  if (init?.method === "POST") { const body = JSON.parse(init.body as string); return response({ success: true, ownerId: admin.id, result: { id: body.action === "abandon-request" ? body.originalIntent.requestId : "saved-record", version: 4, status: body.action === "abandon-request" ? "ABANDONED" : body.action === "start-payout" ? "RESERVED" : body.action === "confirm-payout" ? "PAID" : "RECORDED" } }); }
  return response(page(new URL(url, "http://localhost").searchParams.get("mode") ?? "overview"));
}
beforeEach(() => { jest.clearAllMocks(); sessionStorage.clear(); useAuthStore.setState({ user: admin, loading: false, fetchUser: jest.fn().mockResolvedValue(admin) }); global.fetch = jest.fn().mockImplementation(defaultFetch); });
const view = (mode: "overview" | "policies" | "shipments" | "payouts" = "overview") => render(<StrictMode><SettlementConsole ownerId={admin.id} ownerRole="ADMIN" initialMode={mode} /></StrictMode>);
function affirm() { fireEvent.change(screen.getByLabelText("Operation reason"), { target: { value: "Reviewed actual financial operation" } }); fireEvent.click(screen.getByRole("checkbox", { name: /I confirm the displayed target/ })); }
function submit() { fireEvent.submit(screen.getByRole("form", { name: "Settlement operation" })); }
async function reserveForm() { fireEvent.click(await screen.findByRole("button", { name: `Reserve payout for ${seller.email}` })); fireEvent.change(screen.getByLabelText("Payout amount (BDT)"), { target: { value: "10.00" } }); fireEvent.change(screen.getByLabelText("External payment method"), { target: { value: "BANK" } }); affirm(); }
it("loads once in StrictMode and writes explicit percentage/shipping with the observed global revision", async () => {
  view("policies"); fireEvent.click(await screen.findByRole("button", { name: "Review commercial policy change" })); expect(fetch).toHaveBeenCalledTimes(1); expect(screen.getByLabelText("Commission percent")).toHaveProperty("value", "12.50");
  fireEvent.change(screen.getByLabelText("Commission percent"), { target: { value: "5.25" } }); fireEvent.change(screen.getByLabelText("Shipping recipient"), { target: { value: "SELLER" } }); affirm(); submit();
  await waitFor(() => expect(posts()).toHaveLength(1)); expect(posts()[0]).toMatchObject({ action: "save-policy", scope: "GLOBAL", sellerId: null, version: 3, terms: { commissionBps: 525, shippingRecipient: "SELLER" }, confirmed: true }); await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1)); expect(sessionStorage.getItem(key)).toBeNull();
});
it("keeps unconfigured terms empty and requires a real configured rate/recipient", async () => {
  (fetch as jest.Mock).mockResolvedValue(response(page("policies", { currentPolicy: null, effectivePolicy: null, globalPolicy: null, rows: [], total: 0 })));
  view("policies"); fireEvent.click(await screen.findByRole("button", { name: "Review commercial policy change" })); expect(screen.getByLabelText("Commission percent")).toHaveProperty("value", ""); expect(screen.getByLabelText("Shipping recipient")).toHaveProperty("value", ""); affirm(); submit(); await screen.findByRole("alert"); expect(posts()).toHaveLength(0);
});
it("requires explicit seller inheritance and invalidates affirmation when financial terms change", async () => {
  (fetch as jest.Mock).mockImplementation(async (url, init) => init?.method === "POST" ? defaultFetch(url, init) : response(page("policies", { seller, scopeKey: "SELLER:seller", currentPolicy: { ...policy, scopeKey: "SELLER:seller", version: 2 } })));
  view("policies"); fireEvent.click(await screen.findByRole("button", { name: "Review commercial policy change" })); affirm(); fireEvent.click(screen.getByRole("checkbox", { name: /Inherit the current global/ })); expect(screen.getByRole("checkbox", { name: /I confirm the displayed target/ })).toHaveProperty("checked", false); expect(screen.getByLabelText("Commission percent")).toHaveProperty("disabled", true); fireEvent.click(screen.getByRole("checkbox", { name: /I confirm the displayed target/ })); submit(); await waitFor(() => expect(posts()).toHaveLength(1)); expect(posts()[0]).toMatchObject({ action: "save-policy", scope: "SELLER", sellerId: seller.id, version: 2, terms: null });
});
it("reserves an exact large decimal amount without claiming that a transfer was sent", async () => {
  view(); await reserveForm(); fireEvent.change(screen.getByLabelText("Payout amount (BDT)"), { target: { value: "90071992547409.93" } }); expect(screen.getByRole("checkbox", { name: /I confirm the displayed target/ })).toHaveProperty("checked", false); fireEvent.click(screen.getByRole("checkbox", { name: /I confirm the displayed target/ })); submit(); await waitFor(() => expect(posts()).toHaveLength(1)); expect(posts()[0]).toMatchObject({ action: "start-payout", amountCents: "9007199254740993", sellerId: seller.id, method: "BANK" }); expect(posts()[0]).not.toHaveProperty("paymentStatus");
});
it("requires an actual reference and preserves the observed reserved payout amount/revision", async () => {
  view("payouts"); fireEvent.click(await screen.findByRole("button", { name: "Record transfer payout" })); affirm(); submit(); await screen.findByRole("alert"); expect(posts()).toHaveLength(0); fireEvent.change(screen.getByLabelText("Actual external transaction reference"), { target: { value: "BANK-REFERENCE-123" } }); expect(screen.getByRole("checkbox", { name: /I confirm the displayed target/ })).toHaveProperty("checked", false); fireEvent.click(screen.getByRole("checkbox", { name: /I confirm the displayed target/ })); submit(); await waitFor(() => expect(posts()).toHaveLength(1)); expect(posts()[0]).toMatchObject({ action: "confirm-payout", payoutId: payout.id, version: 1, reference: "BANK-REFERENCE-123" }); expect(posts()[0]).not.toHaveProperty("amountCents");
});
it("requires an explicit no-money-sent declaration before releasing a reservation", async () => {
  view("payouts"); fireEvent.click(await screen.findByRole("button", { name: "Cancel unsent payout payout" })); affirm(); expect(screen.getByRole("button", { name: "Confirm reviewed settlement operation" })).toHaveProperty("disabled", true); fireEvent.click(screen.getByRole("checkbox", { name: /No money was sent/ })); expect(screen.getByRole("checkbox", { name: /I confirm the displayed target/ })).toHaveProperty("checked", false); fireEvent.click(screen.getByRole("checkbox", { name: /I confirm the displayed target/ })); submit(); await waitFor(() => expect(posts()).toHaveLength(1)); expect(posts()[0]).toMatchObject({ action: "cancel-payout", payoutId: payout.id, version: 1, noMoneySent: true });
});
it("preserves an uncertain original intent across remounts and retries exactly its saved UUID/body", async () => {
  let writes = 0; (fetch as jest.Mock).mockImplementation(async (url, init) => { if (init?.method === "POST" && ++writes === 1) throw new Error("Connection interrupted"); return defaultFetch(url, init); });
  const first = view(); await reserveForm(); submit(); await screen.findByText("Connection interrupted"); const original = posts()[0]; expect(JSON.parse(sessionStorage.getItem(key)!).intent).toEqual(original); expect(screen.getByLabelText("Payout amount (BDT)")).toHaveProperty("value", "10.00"); first.unmount();
  view(); await waitFor(() => expect(screen.getByRole("button", { name: "Retry exact original request" })).toHaveProperty("disabled", false)); fireEvent.click(screen.getByRole("button", { name: "Retry exact original request" })); await waitFor(() => expect(posts()).toHaveLength(2)); expect(posts()[1]).toEqual(original); await waitFor(() => expect(sessionStorage.getItem(key)).toBeNull());
});
it("recovers an already committed receipt after reload without issuing the mutation again", async () => {
  sessionStorage.setItem(key, JSON.stringify({ ownerId: admin.id, ownerRole: "ADMIN", intent })); (fetch as jest.Mock).mockResolvedValue(response(page("overview", { attempt: { id: "payout", version: 1, action: "start-payout", status: "RESERVED" } })));
  view(); await waitFor(() => expect(sessionStorage.getItem(key)).toBeNull()); expect(posts()).toHaveLength(0); expect(screen.queryByText("Unresolved original request")).toBeNull(); expect((fetch as jest.Mock).mock.calls[0][0]).toContain(`requestId=${intent.requestId}`);
});
it("resolves an unconfirmed UUID on the server instead of locally discarding it", async () => {
  let writes = 0; (fetch as jest.Mock).mockImplementation(async (url, init) => { if (init?.method === "POST" && ++writes === 1) throw new Error("Lost response"); return defaultFetch(url, init); });
  view(); await reserveForm(); submit(); await screen.findByText("Lost response"); const original = posts()[0]; fireEvent.click(screen.getByRole("checkbox", { name: /I confirm resolving this original request/ })); fireEvent.click(screen.getByRole("button", { name: "Resolve original request on server" })); await waitFor(() => expect(posts()).toHaveLength(2)); expect(posts()[1]).toEqual({ action: "abandon-request", originalIntent: original, confirmed: true }); await waitFor(() => expect(sessionStorage.getItem(key)).toBeNull()); expect(await screen.findByRole("status")).toHaveProperty("textContent", expect.stringContaining("stopped on the server"));
});
it("does not silently rebase a reviewed policy revision after reloading saved data", async () => {
  let revision = 3; (fetch as jest.Mock).mockImplementation(async (url, init) => init?.method === "POST" ? response({ success: false, message: "Commercial policy changed. Reload." }, 409) : response(page("policies", { currentPolicy: { ...policy, version: revision } })));
  view("policies"); fireEvent.click(await screen.findByRole("button", { name: "Review commercial policy change" })); fireEvent.change(screen.getByLabelText("Commission percent"), { target: { value: "9.5" } }); revision = 4; fireEvent.click(screen.getByRole("button", { name: "Reload saved settlement / original receipt" })); await waitFor(() => expect(screen.getByRole("button", { name: "Review commercial policy change" })).toHaveProperty("disabled", false)); expect(screen.getByLabelText("Commission percent")).toHaveProperty("value", "9.5"); affirm(); submit(); await screen.findByText("Commercial policy changed. Reload."); expect(posts()[0].version).toBe(3); expect(posts()[0].terms.commissionBps).toBe(950); expect(sessionStorage.getItem(key)).not.toBeNull();
});
it("adopts exactly the reviewed effective policy and captured shipment revision", async () => {
  view("shipments"); fireEvent.click(await screen.findByRole("button", { name: "Review adoption for shipment" })); affirm(); submit(); await waitFor(() => expect(posts()).toHaveLength(1)); expect(posts()[0]).toMatchObject({ action: "adopt-policy", fulfillmentId: "shipment", policyId: policy.id, version: 1 }); expect(posts()[0]).not.toHaveProperty("commissionBps");
});
it("sends nothing if the exact financial intent cannot be saved locally", async () => {
  view(); await reserveForm(); const storage = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
  try { submit(); await screen.findByText(/no operation was sent/); expect(posts()).toHaveLength(0); } finally { storage.mockRestore(); }
});
it("aborts private reads and removes the old owner's data when the active account changes", async () => {
  let finish!: (value: Response) => void; (fetch as jest.Mock).mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; })); view(); await waitFor(() => expect(finish).toBeDefined()); const signal = (fetch as jest.Mock).mock.calls[0][1].signal; act(() => useAuthStore.setState({ user: null })); expect(signal.aborted).toBe(true); await act(async () => finish(response(page()))); expect(screen.queryByText(seller.email)).toBeNull(); expect(screen.queryByText("Available for new payouts")).toBeNull();
});
it("offers sellers scoped read-only history without administrator financial controls or foreign local intents", async () => {
  sessionStorage.setItem(key, JSON.stringify({ ownerId: admin.id, ownerRole: "ADMIN", intent })); useAuthStore.setState({ user: seller, fetchUser: jest.fn().mockResolvedValue(seller) }); (fetch as jest.Mock).mockResolvedValue(response(page("overview", { ownerId: seller.id, ownerRole: "MEMBER", seller })));
  render(<SettlementConsole ownerId={seller.id} ownerRole="MEMBER" />); await screen.findByText(seller.email); expect(screen.queryByRole("button", { name: /Reserve payout for/ })).toBeNull(); expect(screen.queryByText("Unresolved original request")).toBeNull(); expect((fetch as jest.Mock).mock.calls[0][1].headers["X-Settlement-Owner"]).toBe(seller.id); expect(sessionStorage.getItem(key)).not.toBeNull();
});
