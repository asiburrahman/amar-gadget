/** @jest-environment jsdom */
import { randomUUID } from "node:crypto";
import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SupportContactSettingsConsole } from "@/components/support/contact-settings";
import { useAuthStore } from "@/stores/auth-store";
const user = { id: "settings-admin", name: "Administrator", email: "admin@example.invalid", role: "ADMIN", avatar: null, isVerified: true };
type Settings = { id: string; version: number; email: string | null; phone: string | null; address: string | null; hours: string | null; published: boolean; updatedAt: string };
let saved: Settings | null, events: Array<Record<string, unknown>>, receipts: Map<string, unknown>;
const time = "2026-11-03T10:00:00Z", key = `amar:support-contact:${user.id}`;
const response = (value: unknown, status = 200) => ({ ok: status < 300, status, json: async () => value }) as Response;
async function backend(_url: string, init?: RequestInit) {
  if (init?.method === "POST") {
    const body = JSON.parse(init.body as string);
    if (receipts.has(body.requestId)) return response({ success: true, ownerId: user.id, result: receipts.get(body.requestId) });
    if (body.version !== (saved?.version ?? 0)) return response({ success: false, code: "SUPPORT_CONFLICT", message: "Public contact settings changed." }, 409);
    saved = { id: "PUBLIC", ...body.fields, version: body.version + 1, updatedAt: time }; receipts.set(body.requestId, saved); events.unshift({ id: randomUUID(), version: saved!.version, actorId: user.id, reason: body.reason, verified: body.verified, createdAt: time });
    return response({ success: true, ownerId: user.id, result: saved });
  }
  return response({ success: true, ownerId: user.id, settings: saved, history: { page: 1, total: events.length, totalPages: 1, rows: events } });
}
beforeAll(() => { Object.defineProperty(globalThis.crypto, "randomUUID", { value: randomUUID, configurable: true }); });
beforeEach(() => { sessionStorage.clear(); saved = null; events = []; receipts = new Map(); useAuthStore.setState({ user, loading: false, fetchUser: jest.fn().mockResolvedValue(user) }); global.fetch = jest.fn().mockImplementation(backend); });
const view = () => render(<StrictMode><SupportContactSettingsConsole ownerId={user.id} /></StrictMode>);
const posts = () => (fetch as jest.Mock).mock.calls.filter(([, init]) => init.method === "POST").map(([, init]) => JSON.parse(init.body));
async function fill() {
  await waitFor(() => expect(screen.getByRole("button", { name: "Save contact settings" })).toHaveProperty("disabled", false));
  fireEvent.change(screen.getByLabelText("Support email"), { target: { value: "support@example.invalid" } }); fireEvent.change(screen.getByLabelText("Reason for this change"), { target: { value: "Reviewed the business contact details" } });
}
it("starts empty and lets the administrator save a private draft followed by verified publication", async () => {
  view(); await fill(); expect(screen.getByLabelText("Support phone")).toHaveProperty("value", ""); fireEvent.click(screen.getByRole("button", { name: "Save contact settings" })); await screen.findByText(/saved as unpublished/);
  expect(posts()[0]).toMatchObject({ version: 0, fields: { email: "support@example.invalid", phone: null, address: null, hours: null, published: false }, verified: false });
  fireEvent.click(screen.getByLabelText("Publish these contact details")); fireEvent.click(screen.getByLabelText(/I verified that these details/)); fireEvent.change(screen.getByLabelText("Reason for this change"), { target: { value: "Approved for public customers" } }); fireEvent.click(screen.getByRole("button", { name: "Save contact settings" }));
  await screen.findByText(/saved and published/); expect(posts()[1]).toMatchObject({ version: 1, verified: true, fields: { published: true } }); expect(events).toHaveLength(2); expect(sessionStorage.getItem(key)).toBeNull();
});
it("preserves a typed draft and its old version during reload and rejects a stale save", async () => {
  view(); await fill(); saved = { id: "PUBLIC", email: "rival@example.invalid", phone: null, address: null, hours: null, published: false, version: 1, updatedAt: time };
  fireEvent.click(screen.getByRole("button", { name: "Refresh saved settings" })); await screen.findByText(/Saved version: 1/); expect(screen.getByLabelText("Support email")).toHaveProperty("value", "support@example.invalid"); expect(screen.getByText(/Editing reviewed version 0/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save contact settings" })); await screen.findByRole("alert"); expect(posts()[0].version).toBe(0); expect(saved.email).toBe("rival@example.invalid");
  fireEvent.click(screen.getByRole("button", { name: "Clear rejected settings decision" })); fireEvent.click(screen.getByRole("button", { name: "Load latest into editor" })); expect(screen.getByLabelText("Support email")).toHaveProperty("value", "rival@example.invalid");
});
it("recovers a saved but disconnected operation with one exact receipt after remount", async () => {
  let disconnected = true; (fetch as jest.Mock).mockImplementation(async (url, init) => { const value = await backend(url, init); if (init.method === "POST" && disconnected) { disconnected = false; throw Error("Response lost"); } return value; });
  const first = view(); await fill(); fireEvent.click(screen.getByRole("button", { name: "Save contact settings" })); await screen.findByRole("alert"); const original = posts()[0]; first.unmount(); view(); const retry = await screen.findByRole("button", { name: "Retry original settings decision" }); await waitFor(() => expect(retry).toHaveProperty("disabled", false)); fireEvent.click(retry); await screen.findByText(/saved as unpublished/); expect(posts()[1]).toEqual(original); expect(events).toHaveLength(1); expect(sessionStorage.getItem(key)).toBeNull();
});
it("removes cached draft fields and aborts pending reads on account change", async () => {
  let finish!: (value: Response) => void; (fetch as jest.Mock).mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; })); view(); await waitFor(() => expect(finish).toBeDefined()); const signal = (fetch as jest.Mock).mock.calls.at(-1)[1].signal;
  act(() => useAuthStore.setState({ user: null })); expect(signal.aborted).toBe(true); await act(async () => finish(await backend(""))); expect(screen.queryByLabelText("Support email")).toBeNull();
});
it("keeps the editor and prior saved state unconfirmed after a non-JSON failure", async () => {
  view(); await fill(); (fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 503, json: async () => { throw Error("private proxy diagnostic"); } }); fireEvent.click(screen.getByRole("button", { name: "Refresh saved settings" })); await screen.findByRole("alert"); expect(screen.getByLabelText("Support email")).toHaveProperty("value", "support@example.invalid"); expect(screen.getByRole("button", { name: "Save contact settings" })).toHaveProperty("disabled", true); expect(screen.queryByText("private proxy diagnostic")).toBeNull();
});
it("distinguishes an older recovered receipt from a later administrator's current publication state", async () => {
  let disconnected = true; (fetch as jest.Mock).mockImplementation(async (url, init) => { const value = await backend(url, init); if (init.method === "POST" && disconnected) { disconnected = false; throw Error("Response lost"); } return value; });
  const first = view(); await fill(); fireEvent.click(screen.getByLabelText("Publish these contact details")); fireEvent.click(screen.getByLabelText(/I verified that these details/)); fireEvent.click(screen.getByRole("button", { name: "Save contact settings" })); await screen.findByRole("alert");
  saved = { ...saved!, version: 2, published: false }; first.unmount(); view(); const retry = await screen.findByRole("button", { name: "Retry original settings decision" }); await waitFor(() => expect(retry).toHaveProperty("disabled", false)); fireEvent.click(retry);
  await screen.findByText(/original decision was saved and published at version 1/); await screen.findByText(/Saved version: 2; unpublished/); expect(screen.getByText(/Editing reviewed version 1/)).toBeTruthy(); expect(receipts.size).toBe(1);
});
