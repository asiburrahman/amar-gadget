/** @jest-environment jsdom */
import { randomUUID } from "node:crypto";
import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ContactForm } from "@/components/support/contact-form";
const storageKey = "amar:contact-submission:v1";
const response = (body: unknown, status = 201) => ({ ok: status < 300, status, json: async () => body }) as Response;
const original = { requestId: "fb13b340-261c-4b42-a3b8-f50a6009f0ee", name: "Test Customer", email: "customer@example.invalid", topic: "ORDER", subject: "Delivery inquiry", message: "Please check my delivery information.", consent: true };
beforeAll(() => { Object.defineProperty(globalThis.crypto, "randomUUID", { value: randomUUID, configurable: true }); });
beforeEach(() => {
  sessionStorage.clear(); jest.restoreAllMocks();
  global.fetch = jest.fn().mockImplementation(async (_url, init) => response({ success: true, receipt: { id: JSON.parse(init.body).requestId, receivedAt: "2026-11-03T10:00:00Z" } }));
});
async function fill() {
  await waitFor(() => expect(screen.getByRole("button", { name: "Send message" })).toHaveProperty("disabled", false));
  for (const [label, value] of [["Your name", original.name], ["Contact email", original.email], ["Subject", original.subject], ["Message", original.message]]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole("checkbox"));
}
const sent = () => JSON.parse((fetch as jest.Mock).mock.calls.at(-1)[1].body);
it("submits explicit consent and actual fields, then shows only the confirmed matching receipt", async () => {
  render(<StrictMode><ContactForm /></StrictMode>); await fill();
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByRole("heading", { name: "Message received" });
  expect(sent()).toMatchObject({ name: original.name, email: original.email, message: original.message, consent: true, topic: "ORDER" }); expect(sent()).not.toHaveProperty("orderReference");
  expect((fetch as jest.Mock).mock.calls[0][0]).toBe("/api/contact"); expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toEqual({ receipt: { id: sent().requestId, receivedAt: "2026-11-03T10:00:00Z" } });
  expect(screen.queryByDisplayValue(original.message)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Write another message" })); expect(sessionStorage.getItem(storageKey)).toBeNull(); expect(screen.getByLabelText("Your name")).toHaveProperty("value", "");
});
it("preserves exact uncertain content and identity across a tab component remount", async () => {
  (fetch as jest.Mock).mockRejectedValueOnce(new TypeError("Network disconnected"));
  const first = render(<ContactForm />); await fill(); fireEvent.click(screen.getByRole("button", { name: "Send message" })); await screen.findByRole("alert");
  const attempt = sent(); expect(screen.getByLabelText("Your name").closest("fieldset")).toHaveProperty("disabled", true); first.unmount();
  render(<ContactForm />); const retry = await screen.findByRole("button", { name: "Retry the same message" }); fireEvent.click(retry); await screen.findByRole("heading", { name: "Message received" }); expect(sent()).toEqual(attempt);
});
it("does not present non-JSON failures or a mismatched receipt as success", async () => {
  sessionStorage.setItem(storageKey, JSON.stringify({ intent: original }));
  (fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 503, json: async () => { throw Error("Private proxy diagnostic"); } });
  render(<ContactForm />); fireEvent.click(await screen.findByRole("button", { name: "Retry the same message" })); await screen.findByRole("alert"); expect(screen.queryByRole("heading", { name: "Message received" })).toBeNull(); expect(screen.queryByText("Private proxy diagnostic")).toBeNull();
  (fetch as jest.Mock).mockResolvedValueOnce(response({ success: true, receipt: { id: randomUUID(), receivedAt: "2026-11-03T10:00:00Z" } }));
  fireEvent.click(screen.getByRole("button", { name: "Retry the same message" })); await screen.findByText(/receipt reference does not match/); expect(JSON.parse(sessionStorage.getItem(storageKey)!).intent).toEqual(original);
});
it("blocks a new send when the exact retry intent cannot be persisted", async () => {
  render(<ContactForm />); await fill(); const storage = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("Storage disabled"); });
  fireEvent.click(screen.getByRole("button", { name: "Send message" })); await screen.findByRole("alert"); expect(fetch).not.toHaveBeenCalled(); storage.mockRestore();
});
it("fails closed on corrupt saved content without silently replacing an unfinished request", async () => {
  sessionStorage.setItem(storageKey, "{broken metadata"); render(<ContactForm />); await screen.findByRole("alert"); expect(screen.getByRole("button", { name: "Send message" })).toHaveProperty("disabled", true); expect(fetch).not.toHaveBeenCalled(); expect(sessionStorage.getItem(storageKey)).toBe("{broken metadata");
});
it("allows an explicitly rejected request to be corrected while preserving the typed fields", async () => {
  (fetch as jest.Mock).mockResolvedValueOnce(response({ success: false, message: "Check required fields." }, 400));
  render(<ContactForm />); await fill(); fireEvent.click(screen.getByRole("button", { name: "Send message" })); fireEvent.click(await screen.findByRole("button", { name: "Edit rejected message" }));
  expect(sessionStorage.getItem(storageKey)).toBeNull(); expect(screen.getByLabelText("Your name")).toHaveProperty("value", original.name); expect(screen.getByLabelText("Your name").closest("fieldset")).toHaveProperty("disabled", false);
});
