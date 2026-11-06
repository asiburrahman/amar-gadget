/** @jest-environment jsdom */
import { randomUUID } from "node:crypto";
import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NewsletterForm } from "@/components/newsletter/newsletter-form";
const key = "amar:newsletter-request:v1", time = "2026-11-03T10:00:00Z";
const response = (value: unknown, status = 202) => ({ ok: status < 300, status, json: async () => value }) as Response;
const original = { requestId: "fb13b340-261c-4b42-a3b8-f50a6009f0ee", email: "customer@example.invalid", consent: true };
beforeAll(() => { Object.defineProperty(globalThis.crypto, "randomUUID", { value: randomUUID, configurable: true }); });
beforeEach(() => { sessionStorage.clear(); jest.restoreAllMocks(); global.fetch = jest.fn().mockImplementation(async (_url, init) => response({ success: true, receipt: { requestId: JSON.parse(init.body).requestId, recordedAt: time } })); });
async function fill() { await waitFor(() => expect(screen.getByRole("button", { name: "Request newsletter instructions" })).toHaveProperty("disabled", false)); fireEvent.change(screen.getByLabelText("Email address"), { target: { value: " Customer@Example.Invalid " } }); fireEvent.click(screen.getByRole("checkbox")); }
const posts = () => (fetch as jest.Mock).mock.calls.map(([, init]) => JSON.parse(init.body));
it("records explicit consent and a matching receipt without pretending the reader is already subscribed", async () => {
  render(<StrictMode><NewsletterForm /></StrictMode>); await fill(); expect(screen.getByRole("checkbox", { name: /Send me email instructions to subscribe or manage/ })).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: "Request newsletter instructions" })); await screen.findByText("Newsletter request recorded");
  expect(posts()[0]).toMatchObject({ email: "customer@example.invalid", consent: true }); expect(screen.queryByText("Subscribed!")).toBeNull(); expect(screen.getByText(/does not activate a subscription/)).toBeTruthy(); expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual({ receipt: { requestId: posts()[0].requestId, recordedAt: time } }); expect(screen.queryByDisplayValue(original.email)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Request fresh instructions" })); expect(sessionStorage.getItem(key)).toBeNull(); expect(screen.getByLabelText("Email address")).toHaveProperty("value", "");
});
it("recovers the same original UUID/email/consent after a lost response and remount", async () => {
  (fetch as jest.Mock).mockRejectedValueOnce(Error("Connection lost")); const first = render(<NewsletterForm />); await fill(); fireEvent.click(screen.getByRole("button", { name: "Request newsletter instructions" })); await screen.findByRole("alert"); const initial = posts()[0]; expect(screen.getByLabelText("Email address").closest("fieldset")).toHaveProperty("disabled", true); first.unmount();
  render(<NewsletterForm />); fireEvent.click(await screen.findByRole("button", { name: "Retry original newsletter request" })); await screen.findByText("Newsletter request recorded"); expect(posts()[1]).toEqual(initial);
});
it("keeps failed delivery pending and does not replace it with a fake success", async () => {
  sessionStorage.setItem(key, JSON.stringify({ intent: original })); (fetch as jest.Mock).mockResolvedValueOnce(response({ success: false, code: "NEWSLETTER_DELIVERY_UNAVAILABLE", message: "Provider delivery is unavailable. Retry later." }, 503));
  render(<NewsletterForm />); fireEvent.click(await screen.findByRole("button", { name: "Retry original newsletter request" })); await screen.findByRole("alert"); expect(screen.queryByText("Newsletter request recorded")).toBeNull(); expect(JSON.parse(sessionStorage.getItem(key)!).intent).toEqual(original); expect(screen.queryByRole("button", { name: "Edit rejected or exhausted request" })).toBeNull();
});
it("rejects non-JSON or mismatched receipts without losing the exact retry record", async () => {
  sessionStorage.setItem(key, JSON.stringify({ intent: original })); (fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 503, json: async () => { throw Error("private proxy details"); } }); render(<NewsletterForm />); fireEvent.click(await screen.findByRole("button", { name: "Retry original newsletter request" })); await screen.findByRole("alert"); expect(screen.queryByText("private proxy details")).toBeNull();
  (fetch as jest.Mock).mockResolvedValueOnce(response({ success: true, receipt: { requestId: randomUUID(), recordedAt: time } })); fireEvent.click(screen.getByRole("button", { name: "Retry original newsletter request" })); await screen.findByText(/receipt does not match/); expect(JSON.parse(sessionStorage.getItem(key)!).intent).toEqual(original);
});
it("blocks a new send when tab storage is unavailable rather than discarding an uncertain identity", async () => {
  render(<NewsletterForm />); await fill(); const store = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("Blocked storage"); });
  try { fireEvent.click(screen.getByRole("button", { name: "Request newsletter instructions" })); await screen.findByRole("alert"); expect(fetch).not.toHaveBeenCalled(); } finally { store.mockRestore(); }
});
it("allows a terminal exhausted request to be explicitly replaced without treating it as active consent", async () => {
  sessionStorage.setItem(key, JSON.stringify({ intent: original })); (fetch as jest.Mock).mockResolvedValueOnce(response({ success: false, code: "NEWSLETTER_RETRY_EXHAUSTED", message: "Delivery attempts exhausted." }, 503)); render(<NewsletterForm />); fireEvent.click(await screen.findByRole("button", { name: "Retry original newsletter request" })); fireEvent.click(await screen.findByRole("button", { name: "Edit rejected or exhausted request" })); expect(sessionStorage.getItem(key)).toBeNull(); expect(screen.getByLabelText("Email address")).toHaveProperty("value", original.email);
});
