/** @jest-environment jsdom */
import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NewsletterPreferenceAction } from "@/components/newsletter/preference-action";
const token = `fb13b340-261c-4b42-a3b8-f50a6009f0ee.${"A".repeat(43)}`;
const response = (value: unknown, status = 200) => ({ ok: status < 300, status, json: async () => value }) as Response;
beforeEach(() => { window.history.replaceState(null, "", `/newsletter/confirm#token=${token}`); sessionStorage.clear(); localStorage.clear(); global.fetch = jest.fn().mockResolvedValue(response({ success: true })); });
it("clears a fragment capability without sending or rendering it, including StrictMode effect replay", async () => {
  const view = render(<StrictMode><NewsletterPreferenceAction action="confirm" /></StrictMode>); const button = await screen.findByRole("button", { name: "Confirm subscription" }); await waitFor(() => expect(button).toHaveProperty("disabled", false)); expect(window.location.hash).toBe(""); expect(view.container.textContent).not.toContain(token); expect(sessionStorage.length).toBe(0); expect(localStorage.length).toBe(0); expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(button); await screen.findByText("Your newsletter subscription is confirmed."); expect((fetch as jest.Mock).mock.calls[0][0]).toBe("/api/newsletter/confirm"); const init = (fetch as jest.Mock).mock.calls[0][1]; expect(JSON.parse(init.body)).toEqual({ token }); expect(init.referrerPolicy).toBe("no-referrer"); expect((fetch as jest.Mock).mock.calls[0][0]).not.toContain(token);
});
it("requires an explicit unsubscribe action and confirms only the saved API result", async () => {
  window.history.replaceState(null, "", `/newsletter/unsubscribe#token=${token}`); render(<NewsletterPreferenceAction action="unsubscribe" />); const button = await screen.findByRole("button", { name: "Unsubscribe" }); await waitFor(() => expect(button).toHaveProperty("disabled", false)); expect(fetch).not.toHaveBeenCalled(); fireEvent.click(button); await screen.findByText(/newsletter consent is withdrawn/); expect((fetch as jest.Mock).mock.calls[0][0]).toBe("/api/newsletter/unsubscribe");
});
it("refuses missing, query-only and duplicated fragment tokens", async () => {
  for (const location of ["/newsletter/confirm", `/newsletter/confirm?token=${token}`, `/newsletter/confirm#token=${token}&token=${token}`, "/newsletter/confirm#token=bad"]) {
    window.history.replaceState(null, "", location); const view = render(<NewsletterPreferenceAction action="confirm" />); await screen.findByRole("alert"); expect(screen.getByRole("button", { name: "Confirm subscription" })).toHaveProperty("disabled", true); view.unmount();
  }
  expect(fetch).not.toHaveBeenCalled(); expect(window.location.search).toBe("");
});
it("keeps the capability only in memory for an exact retry after an unknown response", async () => {
  (fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 503, json: async () => { throw Error("private proxy detail"); } }); render(<NewsletterPreferenceAction action="confirm" />); const button = await screen.findByRole("button", { name: "Confirm subscription" }); await waitFor(() => expect(button).toHaveProperty("disabled", false)); fireEvent.click(button); await screen.findByRole("alert"); expect(screen.queryByText("private proxy detail")).toBeNull(); fireEvent.click(button); await screen.findByText("Your newsletter subscription is confirmed."); expect((fetch as jest.Mock).mock.calls.map(([, init]) => JSON.parse(init.body))).toEqual([{ token }, { token }]);
});
it("shows an expired/withdrawn server decision without claiming a preference change", async () => {
  (fetch as jest.Mock).mockResolvedValueOnce(response({ success: false, code: "NEWSLETTER_INVALID_LINK", message: "This link expired. Request fresh instructions." }, 400)); render(<NewsletterPreferenceAction action="confirm" />); const button = await screen.findByRole("button", { name: "Confirm subscription" }); await waitFor(() => expect(button).toHaveProperty("disabled", false)); fireEvent.click(button); await screen.findByRole("alert"); expect(screen.queryByText("Your newsletter subscription is confirmed.")).toBeNull(); expect(screen.getByRole("link", { name: "Request fresh newsletter instructions" }).getAttribute("href")).toBe("/newsletter");
});
it("aborts an in-flight preference write on unmount and ignores its late response", async () => {
  let complete!: (value: Response) => void; (fetch as jest.Mock).mockImplementation(() => new Promise<Response>((resolve) => { complete = resolve; })); const view = render(<NewsletterPreferenceAction action="confirm" />); const button = await screen.findByRole("button", { name: "Confirm subscription" }); await waitFor(() => expect(button).toHaveProperty("disabled", false)); fireEvent.click(button); const signal = (fetch as jest.Mock).mock.calls[0][1].signal; view.unmount(); expect(signal.aborted).toBe(true); await act(async () => complete(response({ success: true })));
});
it("accepts a newly opened email fragment in the same page without reusing the old success or auto-applying it", async () => {
  render(<NewsletterPreferenceAction action="confirm" />); const originalButton = await screen.findByRole("button", { name: "Confirm subscription" }); await waitFor(() => expect(originalButton).toHaveProperty("disabled", false)); fireEvent.click(originalButton); await screen.findByText("Your newsletter subscription is confirmed.");
  const newer = token.replace(/A+$/, "B".repeat(43)); await act(async () => { window.history.pushState(null, "", `/newsletter/confirm#token=${newer}`); window.dispatchEvent(new HashChangeEvent("hashchange")); });
  const next = await screen.findByRole("button", { name: "Confirm subscription" }); await waitFor(() => expect(next).toHaveProperty("disabled", false)); expect(screen.queryByText("Your newsletter subscription is confirmed.")).toBeNull(); expect(fetch).toHaveBeenCalledTimes(1); expect(window.location.hash).toBe(""); fireEvent.click(next); await screen.findByText("Your newsletter subscription is confirmed."); expect(JSON.parse((fetch as jest.Mock).mock.calls[1][1].body)).toEqual({ token: newer });
});
