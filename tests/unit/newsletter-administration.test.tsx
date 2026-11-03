/** @jest-environment jsdom */
import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NewsletterAdministrationConsole } from "@/components/newsletter/administration";
import { useAuthStore } from "@/stores/auth-store";
const user = { id: "newsletter-admin", name: "Administrator", email: "admin@example.invalid", role: "ADMIN", avatar: null, isVerified: true }, time = "2026-11-03T10:00:00Z";
const response = (value: unknown, status = 200) => ({ ok: status < 300, status, json: async () => value }) as Response;
const consent = { id: "subscriber-one", email: "private-sender@example.invalid", status: "PENDING", consentVersion: "newsletter-v1", consentedAt: time, confirmedAt: null, unsubscribedAt: null, lastRequestedAt: time, createdAt: time };
const delivery = { id: "request-one", email: consent.email, generation: 1, state: "FAILED", attempts: 2, nextAttemptAt: time, leaseUntil: null, sentAt: null, lastErrorCode: "TRANSPORT", createdAt: time, updatedAt: time };
function page(mode = "SUBSCRIBERS", query: URLSearchParams = new URLSearchParams()) { return mode === "SUBSCRIBERS" ? { success: true, ownerId: user.id, mode, status: query.get("status") ?? "ALL", page: 1, total: 1, totalPages: 1, counts: { PENDING: 1, ACTIVE: 0, UNSUBSCRIBED: 0 }, rows: [consent] } : { success: true, ownerId: user.id, mode, state: query.get("state") ?? "ALL", page: 1, total: 1, totalPages: 1, counts: { READY: 0, SENDING: 0, SENT: 0, FAILED: 1, SUPPRESSED: 0, DEAD: 0 }, rows: [delivery] }; }
beforeEach(() => { useAuthStore.setState({ user, loading: false, fetchUser: jest.fn().mockResolvedValue(user) }); global.fetch = jest.fn().mockImplementation(async (url) => { const params = new URL(url, "http://localhost").searchParams; return response(page(params.get("mode") ?? "SUBSCRIBERS", params)); }); });
const view = () => render(<StrictMode><NewsletterAdministrationConsole ownerId={user.id} /></StrictMode>);
it("loads actual private consent records and explicitly applies delivery mode and failure labels", async () => {
  view(); await screen.findByRole("heading", { name: consent.email }); expect(screen.getByText(/PENDING: 1; ACTIVE: 0/)).toBeTruthy(); expect((fetch as jest.Mock).mock.calls[0][1].headers["X-Newsletter-Owner"]).toBe(user.id);
  fireEvent.change(screen.getByLabelText("Newsletter view"), { target: { value: "DELIVERIES" } }); fireEvent.change(screen.getByLabelText("Newsletter delivery filter"), { target: { value: "FAILED" } }); fireEvent.click(screen.getByRole("button", { name: "Load newsletter records" })); await screen.findByText(/SMTP attempt not confirmed/); expect((fetch as jest.Mock).mock.calls.at(-1)[0]).toContain("state=FAILED"); expect(screen.getByText(/FAILED; 2 attempts/)).toBeTruthy(); expect(screen.queryByRole("button", { name: /Send campaign/ })).toBeNull();
});
it("retains the previous unconfirmed view on a non-JSON failure without inventing an empty healthy queue", async () => {
  view(); await screen.findByRole("heading", { name: consent.email }); (fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 503, json: async () => { throw Error("private proxy diagnostic"); } }); fireEvent.click(screen.getByRole("button", { name: "Load newsletter records" })); await screen.findByRole("alert"); expect(screen.getByRole("heading", { name: consent.email })).toBeTruthy(); expect(screen.getByText(/Previous view is unconfirmed/)).toBeTruthy(); expect(screen.queryByText("private proxy diagnostic")).toBeNull();
});
it("removes cached private addresses on a server authority rejection", async () => {
  view(); await screen.findByRole("heading", { name: consent.email }); (fetch as jest.Mock).mockResolvedValueOnce(response({ success: false, code: "NEWSLETTER_FORBIDDEN", message: "Access changed." }, 403)); fireEvent.click(screen.getByRole("button", { name: "Load newsletter records" })); await screen.findByText(/Private newsletter data has been removed/); expect(screen.queryByRole("heading", { name: consent.email })).toBeNull();
});
it("rejects a successful response bound to another viewer and removes the cached address", async () => {
  view(); await screen.findByRole("heading", { name: consent.email }); (fetch as jest.Mock).mockResolvedValueOnce(response({ ...page(), ownerId: "other-administrator" })); fireEvent.click(screen.getByRole("button", { name: "Load newsletter records" })); await screen.findByText(/Private newsletter data has been removed/); expect(screen.queryByRole("heading", { name: consent.email })).toBeNull();
});
it("aborts pending work and removes the private view when the active account changes", async () => {
  let complete!: (value: Response) => void; (fetch as jest.Mock).mockImplementation(() => new Promise<Response>((resolve) => { complete = resolve; })); view(); await waitFor(() => expect(complete).toBeDefined()); const signal = (fetch as jest.Mock).mock.calls.at(-1)[1].signal;
  act(() => useAuthStore.setState({ user: null })); expect(signal.aborted).toBe(true); await act(async () => complete(response(page()))); expect(screen.queryByRole("heading", { name: consent.email })).toBeNull();
});
it("rejects malformed saved counts rather than confirming fabricated metadata", async () => {
  (fetch as jest.Mock).mockResolvedValueOnce(response({ ...page(), counts: {} })); view(); await screen.findByRole("alert"); expect(screen.queryByRole("heading", { name: consent.email })).toBeNull(); expect(screen.queryByText(/Saved view loaded/)).toBeNull();
});
