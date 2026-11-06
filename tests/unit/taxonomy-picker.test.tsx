/** @jest-environment jsdom */
import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TaxonomyPicker } from "@/components/catalog/taxonomy-picker";
const response = (items: unknown[], page = 1, q = "", total = 26) => ({ ok: true, json: async () => ({ success: true, categories: items, pagination: { page, limit: 25, total, totalPages: Math.ceil(total / 25), q } }) }) as Response;
function Editor() {
  const [value, setValue] = useState("saved");
  return <TaxonomyPicker kind="category" required value={value} savedChoice={{ id: "saved", name: "Saved category", pathLabel: "Older parent / Saved category" }} onChange={setValue} />;
}
beforeEach(() => { global.fetch = jest.fn(); });
it("keeps the saved/current choice across real page/search navigation and never replaces it with the first result", async () => {
  (fetch as jest.Mock).mockResolvedValueOnce(response([{ id: "first", name: "First" }])).mockResolvedValueOnce(response([{ id: "next", name: "Next", pathLabel: "Root / Next" }], 2)).mockResolvedValueOnce(response([], 1, "absent", 0));
  render(<Editor />); await screen.findByRole("option", { name: "First" });
  expect(screen.getByRole("combobox")).toHaveProperty("value", "saved");
  fireEvent.click(screen.getByRole("button", { name: "Next category choices" }));
  await screen.findByRole("option", { name: "Root / Next" }); expect(screen.getByRole("combobox")).toHaveProperty("value", "saved");
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "next" } }); expect(screen.getByRole("combobox")).toHaveProperty("value", "next");
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "absent" } }); fireEvent.click(screen.getByRole("button", { name: "Find category" }));
  await screen.findByText(/0 matching choices/); expect(screen.getByRole("combobox")).toHaveProperty("value", "next"); expect(screen.getByRole("option", { name: "Root / Next" })).toBeTruthy();
  expect((fetch as jest.Mock).mock.calls.map(([url]) => url)).toEqual(["/api/categories?q=&page=1", "/api/categories?q=&page=2", "/api/categories?q=absent&page=1"]);
});
it("shows a safe correlated failure, retains the selected value and retries the same failed page", async () => {
  const reference = "fb13b340-261c-4b42-a3b8-f50a6009f0ee";
  (fetch as jest.Mock).mockResolvedValueOnce(response([{ id: "first", name: "First" }])).mockResolvedValueOnce({ ok: false, json: async () => ({ success: false, reference, message: "private SQL credentials" }) }).mockResolvedValueOnce(response([{ id: "next", name: "Next" }], 2));
  render(<Editor />); await screen.findByRole("option", { name: "First" }); fireEvent.click(screen.getByRole("button", { name: "Next category choices" }));
  expect((await screen.findByRole("alert")).textContent).toContain(reference); expect(screen.queryByText(/private SQL/)).toBeNull(); expect(screen.getByRole("combobox")).toHaveProperty("value", "saved");
  fireEvent.click(screen.getByRole("button", { name: "Retry category choices" })); await screen.findByRole("option", { name: "Next" });
  expect((fetch as jest.Mock).mock.calls[2][0]).toBe("/api/categories?q=&page=2"); expect(screen.queryByRole("alert")).toBeNull();
});
it("rejects malformed success payloads instead of declaring an empty lookup successful", async () => {
  (fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ success: true, categories: [], pagination: { page: 999 } }) });
  render(<Editor />); await screen.findByRole("alert"); expect(screen.getByRole("combobox")).toHaveProperty("value", "saved"); expect(screen.queryByText(/0 matching choices/)).toBeNull();
});
it("aborts an unmounted lookup and ignores a late result", async () => {
  let finish!: (value: Response) => void; (fetch as jest.Mock).mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
  const view = render(<Editor />); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1)); const signal = (fetch as jest.Mock).mock.calls[0][1].signal;
  view.unmount(); expect(signal.aborted).toBe(true); await act(async () => finish(response([{ id: "late", name: "Late" }])));
  expect(screen.queryByRole("combobox")).toBeNull();
});
it("ends a timed-out request with a retryable error and keeps the saved selection", async () => {
  jest.useFakeTimers();
  try {
    (fetch as jest.Mock).mockImplementation((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(Error("timeout")))));
    render(<Editor />); await act(async () => { jest.advanceTimersByTime(15_000); });
    expect(screen.getByRole("alert")).toBeTruthy(); expect(screen.queryByText("Loading category choices...")).toBeNull(); expect(screen.getByRole("combobox")).toHaveProperty("value", "saved");
  } finally { jest.useRealTimers(); }
});
