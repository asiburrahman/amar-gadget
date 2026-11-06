/** @jest-environment jsdom */
import { randomUUID } from "node:crypto";
import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SiteContentEditor } from "@/components/content/site-content-editor";
import { useAuthStore } from "@/stores/auth-store";
import type { SiteContentFields, SiteContentMutation } from "@/lib/validations/site-content";

const owner = { id: "content-admin", name: "Administrator", email: "content@example.invalid", role: "ADMIN", avatar: null, isVerified: true };
const address = { kind: "PAGE" as const, slug: "about" }, time = "2026-11-05T08:00:00.000Z";
const storageKey = `amar:site-content:${owner.id}:PAGE:about`;
type Saved = typeof address & { version: number; draft: SiteContentFields; publishedVersion: number | null; publishedAt: string | null; updatedAt: string };
type Entry = { version: number; action: string; actorId: string; reason: string; reviewed: boolean; createdAt: string };
let saved: Saved | null, history: Entry[], receipts: Map<string, Saved & { path: string }>;
const response = (value: unknown, status = 200) => ({ ok: status < 300, status, json: async () => value }) as Response;
async function backend(_url: string, init?: RequestInit) {
  if (init?.method === "POST") {
    const input = JSON.parse(init.body as string) as SiteContentMutation;
    if (receipts.has(input.requestId)) return response({ success: true, ownerId: owner.id, result: receipts.get(input.requestId) });
    if (input.version !== (saved?.version ?? 0)) return response({ success: false, message: "This document changed. Load the latest saved revision.", code: "SITE_CONTENT_CONFLICT" }, 409);
    const publishedVersion = input.action === "PUBLISH" ? input.version + 1 : input.action === "UNPUBLISH" ? null : saved?.publishedVersion ?? null;
    saved = { ...address, version: input.version + 1, draft: input.action === "DRAFT" ? input.fields : saved!.draft, publishedVersion,
      publishedAt: publishedVersion ? time : null, updatedAt: time };
    history.unshift({ version: saved.version, action: input.action, actorId: owner.id, reason: input.reason, reviewed: input.action === "PUBLISH", createdAt: time });
    const receipt = { ...saved, path: "/about" }; receipts.set(input.requestId, receipt);
    return response({ success: true, ownerId: owner.id, result: receipt });
  }
  return response({ success: true, ownerId: owner.id, address, document: saved, publication: null, history: { page: 1, total: history.length, totalPages: 1, rows: history } });
}
beforeAll(() => { Object.defineProperty(globalThis.crypto, "randomUUID", { value: randomUUID, configurable: true }); });
beforeEach(() => {
  sessionStorage.clear(); saved = null; history = []; receipts = new Map();
  useAuthStore.setState({ user: owner, loading: false, fetchUser: jest.fn().mockResolvedValue(owner) });
  global.fetch = jest.fn().mockImplementation(backend);
});
const mount = () => render(<StrictMode><SiteContentEditor ownerId={owner.id} address={address} /></StrictMode>);
const posts = () => (fetch as jest.Mock).mock.calls.filter(([, init]) => init.method === "POST").map(([, init]) => JSON.parse(init.body));
async function fill() {
  await waitFor(() => expect(screen.getByRole("button", { name: "Save private draft" })).toHaveProperty("disabled", false));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Actual operator introduction" } });
  fireEvent.change(screen.getByLabelText("Summary"), { target: { value: "Reviewed information provided by the marketplace operator." } });
  fireEvent.click(screen.getByRole("button", { name: "Add section" }));
  fireEvent.change(screen.getByLabelText("Heading"), { target: { value: "Our marketplace" } });
  fireEvent.change(screen.getByLabelText("Body"), { target: { value: "Published information confirmed by the operator." } });
  fireEvent.change(screen.getByLabelText("Reason for this decision"), { target: { value: "Save the actual operator introduction" } });
}
async function saveDraft() {
  fireEvent.click(screen.getByRole("button", { name: "Save private draft" }));
  await screen.findByText(/Original draft decision confirmed at revision 1/);
  await waitFor(() => expect(screen.getByRole("button", { name: "Refresh saved state" })).toHaveProperty("disabled", false));
}

it("saves a private structured draft, publishes only its reviewed revision and retains the unpublish history", async () => {
  mount(); await fill();
  expect(screen.getByRole("button", { name: "Publish reviewed saved draft" })).toHaveProperty("disabled", true);
  await saveDraft(); expect(saved!.publishedVersion).toBeNull();
  fireEvent.click(screen.getByLabelText(/I reviewed this exact saved draft/));
  fireEvent.change(screen.getByLabelText("Reason for this decision"), { target: { value: "Approve this saved introduction for customers" } });
  fireEvent.click(screen.getByRole("button", { name: "Publish reviewed saved draft" }));
  await screen.findByText(/Original publish decision confirmed at revision 2/);
  expect(posts()[1]).toMatchObject({ action: "PUBLISH", version: 1, reviewed: true }); expect(posts()[1]).not.toHaveProperty("fields");
  await waitFor(() => expect(screen.getByRole("button", { name: "Unpublish document" })).toHaveProperty("disabled", false));
  fireEvent.change(screen.getByLabelText("Reason for this decision"), { target: { value: "Withdraw publication pending a further review" } });
  fireEvent.click(screen.getByRole("button", { name: "Unpublish document" }));
  await screen.findByText(/Original unpublish decision confirmed at revision 3/);
  expect(saved!.publishedVersion).toBeNull(); expect(history.map((entry) => entry.action)).toEqual(["UNPUBLISH", "PUBLISH", "DRAFT"]);
  expect(sessionStorage.getItem(storageKey)).toBeNull();
});

it("preserves unsaved edits and their reviewed version across refresh instead of silently rebasing a conflicting save", async () => {
  mount(); await fill();
  saved = { ...address, version: 1, draft: { title: "Rival private draft", summary: "Rival administrator summary.", byline: "", sections: [] }, publishedVersion: null, publishedAt: null, updatedAt: time };
  fireEvent.click(screen.getByRole("button", { name: "Refresh saved state" })); await screen.findByText(/Saved revision 1;/);
  expect(screen.getByLabelText("Title")).toHaveProperty("value", "Actual operator introduction");
  expect(screen.getByText(/Editing revision 0/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save private draft" })); await screen.findByRole("alert");
  expect(posts()[0].version).toBe(0); expect(saved.draft.title).toBe("Rival private draft");
  fireEvent.click(screen.getByRole("button", { name: "Clear rejected content decision" }));
  fireEvent.click(screen.getByRole("button", { name: "Load latest into editor" }));
  expect(screen.getByLabelText("Title")).toHaveProperty("value", "Rival private draft");
});

it("recovers a disconnected decision by its original reference after remount without applying it again", async () => {
  let disconnect = true;
  (fetch as jest.Mock).mockImplementation(async (url, init) => { const result = await backend(url, init); if (init.method === "POST" && disconnect) { disconnect = false; throw Error("Private network diagnostics"); } return result; });
  const first = mount(); await fill(); fireEvent.click(screen.getByRole("button", { name: "Save private draft" })); await screen.findByRole("alert");
  expect(screen.queryByText("Private network diagnostics")).toBeNull();
  const original = posts()[0]; first.unmount(); mount();
  const retry = await screen.findByRole("button", { name: "Retry original content decision" });
  await waitFor(() => expect(retry).toHaveProperty("disabled", false)); fireEvent.click(retry);
  await screen.findByText(/Original draft decision confirmed at revision 1/);
  expect(posts()[1]).toEqual(original); expect(history).toHaveLength(1); expect(sessionStorage.getItem(storageKey)).toBeNull();
});

it("keeps publication disabled for changed text until the new draft is saved and explicitly reviewed", async () => {
  mount(); await fill(); await saveDraft();
  fireEvent.click(screen.getByLabelText(/I reviewed this exact saved draft/));
  expect(screen.getByRole("button", { name: "Publish reviewed saved draft" })).toHaveProperty("disabled", false);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Unsaved replacement" } });
  expect(screen.getByLabelText(/I reviewed this exact saved draft/)).toHaveProperty("checked", false);
  expect(screen.getByRole("button", { name: "Publish reviewed saved draft" })).toHaveProperty("disabled", true);
  expect(posts()).toHaveLength(1);
});

it("aborts outstanding reads and removes the private editor when the account changes", async () => {
  let finish!: (value: Response) => void;
  (fetch as jest.Mock).mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
  mount(); await waitFor(() => expect(finish).toBeDefined());
  const signal = (fetch as jest.Mock).mock.calls.at(-1)[1].signal;
  act(() => useAuthStore.setState({ user: null })); expect(signal.aborted).toBe(true);
  await act(async () => finish(await backend("")));
  expect(screen.queryByLabelText("Title")).toBeNull(); expect(screen.queryByText(/Retained history/)).toBeNull();
});

it("retains an uncertain decision if the server receipt contains another snapshot", async () => {
  (fetch as jest.Mock).mockImplementation(async (url, init) => {
    const result = await backend(url, init);
    if (init.method !== "POST") return result;
    const body = await result.json(); return response({ ...body, result: { ...body.result, draft: { ...body.result.draft, title: "Mismatched receipt" } } });
  });
  mount(); await fill(); fireEvent.click(screen.getByRole("button", { name: "Save private draft" }));
  await screen.findByRole("alert"); expect(sessionStorage.getItem(storageKey)).not.toBeNull();
  expect(screen.queryByText(/decision confirmed at revision/)).toBeNull();
  expect(screen.getByRole("button", { name: "Retry original content decision" })).toBeTruthy();
});

it("keeps stale state unconfirmed after a malformed refresh and never renders raw transport diagnostics", async () => {
  mount(); await fill();
  (fetch as jest.Mock).mockResolvedValueOnce({ status: 503, ok: false, json: async () => { throw Error("Private upstream trace"); } });
  fireEvent.click(screen.getByRole("button", { name: "Refresh saved state" })); await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "Save private draft" })).toHaveProperty("disabled", true);
  expect(screen.getByLabelText("Title")).toHaveProperty("value", "Actual operator introduction");
  expect(screen.queryByText("Private upstream trace")).toBeNull();
});

it("refuses corrupt saved decisions without sending a replacement operation", async () => {
  sessionStorage.setItem(storageKey, JSON.stringify({ ownerId: "another-admin", input: {} }));
  mount(); await screen.findByRole("alert"); expect(posts()).toHaveLength(0);
  expect(screen.getByRole("button", { name: "Save private draft" })).toHaveProperty("disabled", true);
  expect(sessionStorage.getItem(storageKey)).not.toBeNull();
});
