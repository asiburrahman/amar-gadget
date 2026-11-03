/** @jest-environment jsdom */
import { randomUUID } from "node:crypto";
import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SupportConsole } from "@/components/support/support-console";
import { useAuthStore } from "@/stores/auth-store";
const user = { id: "support-admin", name: "Administrator", email: "admin@example.invalid", role: "ADMIN", avatar: null, isVerified: true };
const id = "fb13b340-261c-4b42-a3b8-f50a6009f0ee", time = "2026-11-03T10:00:00Z", storageKey = `amar:support-decision:${user.id}`;
const initial = { id, name: "Private Sender", email: "private-sender@example.invalid", topic: "ORDER", subject: "Shipment inquiry", orderReference: "Sender-supplied reference", message: "Private original support message.", consentAt: time, status: "OPEN", version: 1, createdAt: time, updatedAt: time };
let record: typeof initial, events: Array<Record<string, unknown>>, receipts: Map<string, unknown>;
const response = (value: unknown, status = 200) => ({ ok: status < 300, status, json: async () => value }) as Response;
async function backend(path: string, init?: RequestInit) {
  if (init?.method === "POST") {
    const body = JSON.parse(init.body as string);
    if (receipts.has(body.requestId)) return response({ success: true, ownerId: user.id, result: receipts.get(body.requestId) });
    if (body.version !== record.version) return response({ success: false, code: "SUPPORT_CONFLICT", message: "The saved status changed. Reload before making another decision." }, 409);
    events.unshift({ id: randomUUID(), messageId: id, version: record.version + 1, actorId: user.id, beforeStatus: record.status, afterStatus: body.status, reason: body.reason, createdAt: time });
    record = { ...record, status: body.status, version: record.version + 1 };
    const result = { id, status: record.status, version: record.version, updatedAt: time }; receipts.set(body.requestId, result); return response({ success: true, ownerId: user.id, result });
  }
  const query = new URL(path, "http://localhost").searchParams;
  if (query.has("id")) return response({ success: true, ownerId: user.id, message: record, history: { page: 1, total: events.length, totalPages: 1, rows: events } });
  const status = query.get("status") ?? "OPEN", topic = query.get("topic") ?? "ALL", matching = (status === "ALL" || record.status === status) && (topic === "ALL" || record.topic === topic);
  return response({ success: true, ownerId: user.id, status, topic, page: 1, total: matching ? 1 : 0, totalPages: 1, counts: { OPEN: Number(record.status === "OPEN"), IN_PROGRESS: Number(record.status === "IN_PROGRESS"), RESOLVED: Number(record.status === "RESOLVED") }, rows: matching ? [record] : [] });
}
beforeAll(() => { Object.defineProperty(globalThis.crypto, "randomUUID", { value: randomUUID, configurable: true }); });
beforeEach(() => {
  sessionStorage.clear(); record = { ...initial }; events = []; receipts = new Map();
  useAuthStore.setState({ user, loading: false, fetchUser: jest.fn().mockResolvedValue(user) }); global.fetch = jest.fn().mockImplementation(backend);
});
const view = () => render(<StrictMode><SupportConsole ownerId={user.id} /></StrictMode>);
async function choose() { fireEvent.click(await screen.findByRole("button", { name: "Open inquiry: Shipment inquiry" })); await screen.findByText(/Reviewed decision:/); }
const posts = () => (fetch as jest.Mock).mock.calls.filter(([, init]) => init.method === "POST").map(([, init]) => JSON.parse(init.body));

it("loads actual queue/private detail, sends the reviewed revision and refreshes saved status/history", async () => {
  view(); await choose(); expect(screen.getByText(/Private Sender/)).toBeTruthy(); expect(screen.getByText(initial.message)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Status reason"), { target: { value: "Reviewing the shipment" } }); fireEvent.click(screen.getByRole("button", { name: "Save status decision" }));
  await screen.findByText(/status decision is saved/); expect(posts()[0]).toMatchObject({ id, version: 1, status: "IN_PROGRESS", reason: "Reviewing the shipment" }); expect(events).toHaveLength(1); expect(sessionStorage.getItem(storageKey)).toBeNull(); expect(screen.getByText(/0 matching messages/)).toBeTruthy();
  expect((fetch as jest.Mock).mock.calls.every(([, init]) => init.headers["X-Support-Owner"] === user.id)).toBe(true);
});
it("keeps the originally reviewed revision after refresh and rejects the stale decision visibly", async () => {
  view(); await choose(); record = { ...record, status: "RESOLVED", version: 2 };
  fireEvent.click(screen.getByRole("button", { name: "Refresh this inquiry" })); await screen.findByText(/saved state: RESOLVED, revision 2/);
  expect(screen.getByText(/Reviewed decision:/).textContent).toContain("OPEN, revision 1");
  fireEvent.change(screen.getByLabelText("Status reason"), { target: { value: "Original reviewed decision" } }); fireEvent.click(screen.getByRole("button", { name: "Save status decision" }));
  await screen.findByRole("alert"); expect(posts()[0].version).toBe(1); expect(record.version).toBe(2); expect(events).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Clear rejected decision and review again" })); expect(sessionStorage.getItem(storageKey)).toBeNull(); expect(screen.queryByText(/Reviewed decision:/)).toBeNull();
});
it("recovers a committed but lost response after remount using the exact durable decision", async () => {
  let lost = true; (fetch as jest.Mock).mockImplementation(async (path, init) => { const result = await backend(path, init); if (init.method === "POST" && lost) { lost = false; throw Error("Response disconnected"); } return result; });
  const first = view(); await choose(); fireEvent.change(screen.getByLabelText("Status reason"), { target: { value: "Reviewing original inquiry" } }); fireEvent.click(screen.getByRole("button", { name: "Save status decision" })); await screen.findByRole("alert");
  const original = posts()[0]; expect(events).toHaveLength(1); first.unmount(); view(); const retry = await screen.findByRole("button", { name: "Retry original status decision" }); await waitFor(() => expect(retry).toHaveProperty("disabled", false)); fireEvent.click(retry);
  await screen.findByText(/status decision is saved/); expect(posts()[1]).toEqual(original); expect(events).toHaveLength(1); expect(sessionStorage.getItem(storageKey)).toBeNull();
});
it("removes private cached sender content immediately when the server rejects current authority", async () => {
  view(); await choose(); (fetch as jest.Mock).mockResolvedValueOnce(response({ success: false, message: "Administrator access changed.", code: "SUPPORT_FORBIDDEN" }, 403));
  fireEvent.click(screen.getByRole("button", { name: "Refresh this inquiry" })); await screen.findByText(/Private support data has been removed/); expect(screen.queryByText(initial.message)).toBeNull(); expect(screen.queryByText(/private-sender@example.invalid/)).toBeNull();
});
it("aborts private work and unmounts cached data when the active account changes", async () => {
  let complete!: (value: Response) => void; (fetch as jest.Mock).mockImplementation(() => new Promise<Response>((resolve) => { complete = resolve; })); view(); await waitFor(() => expect(complete).toBeDefined()); const signal = (fetch as jest.Mock).mock.calls.at(-1)[1].signal;
  act(() => useAuthStore.setState({ user: null })); expect(signal.aborted).toBe(true); await act(async () => complete(await backend("/api/admin/support"))); expect(screen.queryByRole("heading", { name: initial.subject })).toBeNull();
});
it("retains the prior unconfirmed queue when a proxy fails instead of inventing an empty result", async () => {
  view(); await screen.findByRole("heading", { name: initial.subject }); (fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 503, json: async () => { throw Error("Private proxy details"); } });
  fireEvent.click(screen.getByRole("button", { name: "Load support messages" })); await screen.findByRole("alert"); expect(screen.getByRole("heading", { name: initial.subject })).toBeTruthy(); expect(screen.getByText(/Previous queue is unconfirmed/)).toBeTruthy(); expect(screen.queryByText("Private proxy details")).toBeNull();
});
