/** @jest-environment jsdom */
import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProductMaintenanceConsole } from "@/components/catalog/product-maintenance-console";
import { useAuthStore } from "@/stores/auth-store";
const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const owner = { id: "seller", name: "Seller", email: "seller@example.invalid", role: "MEMBER", sellerStatus: "APPROVED", isVerified: true, avatar: null };
const row = { id: "product", name: "Original gadget", slug: "original-gadget", description: null, specifications: [], price: 100, discountPrice: null, stock: 10, imageUrl: null, images: [], isFeatured: false, status: "APPROVED", catalogVersion: 3, inventoryVersion: 7, mediaVersion: 1, categoryId: "category", brandId: null, category: { name: "Saved category" }, brand: null, createdAt: "2026-11-02T00:00:00Z", _count: { orderItems: 2 } };
const page = (changes = {}) => ({ success: true, ownerId: owner.id, rows: [row], events: [], total: 1, page: 1, totalPages: 1, attempt: null, attemptedRow: null, ...changes });
const response = (value: unknown, status = 200) => ({ ok: status < 300, status, json: async () => value }) as Response;
const posts = () => (fetch as jest.Mock).mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(init.body));
const initialFetch = async (url: string, init?: RequestInit) => response(url === "/api/categories" ? { success: true, categories: [{ id: "category", name: "Saved category" }] } : url === "/api/brands" ? { success: true, brands: [] } : init?.method === "POST" ? { success: true, ownerId: owner.id, result: { id: row.id, version: 4 }, row: { ...row, catalogVersion: 4, status: "PENDING_APPROVAL" } } : page());
beforeEach(() => { jest.clearAllMocks(); useAuthStore.setState({ user: owner, loading: false, fetchUser: jest.fn().mockResolvedValue(owner) }); global.fetch = jest.fn().mockImplementation(initialFetch); });
const view = () => render(<StrictMode><ProductMaintenanceConsole ownerId={owner.id} ownerRole="MEMBER" /></StrictMode>);
async function choose() { fireEvent.click(await screen.findByRole("button", { name: "Edit Original gadget" })); fireEvent.change(screen.getByLabelText("Operation reason"), { target: { value: "Verified warehouse correction" } }); }
it("edits real metadata with the observed catalog revision and leaves inventory out of content changes", async () => {
  view(); await choose(); expect(screen.getByRole("link", { name: "Manage images" }).getAttribute("href")).toBe(`/member/products/${row.id}/images`); fireEvent.change(screen.getByLabelText("Product name"), { target: { value: "Revised gadget" } }); fireEvent.click(screen.getByRole("button", { name: "Save catalog content for review" }));
  await waitFor(() => expect(posts()).toHaveLength(1)); expect(posts()[0]).toMatchObject({ action: "edit", id: row.id, version: 3, reason: "Verified warehouse correction", fields: { name: "Revised gadget", categoryId: "category", price: 100 } }); expect(posts()[0].fields).not.toHaveProperty("stock"); expect(posts()[0].fields).not.toHaveProperty("status");
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1)); expect((fetch as jest.Mock).mock.calls.filter(([url, init]) => url === "/api/member/products?page=1&q=&status=ALL" && init.method === "GET")).toHaveLength(1);
});
it("sends a signed stock delta with both revisions and invalidates affirmation when the operation changes", async () => {
  view(); await choose(); fireEvent.change(screen.getByLabelText("Adjustment"), { target: { value: "REMOVE" } }); fireEvent.change(screen.getByLabelText("Units"), { target: { value: "3" } }); fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.getByRole("button", { name: "Archive saved product" })).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByLabelText("Operation to confirm"), { target: { value: "archive" } }); expect(screen.getByRole("checkbox")).toHaveProperty("checked", false); expect(screen.getByRole("button", { name: "Apply inventory adjustment" })).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByLabelText("Operation to confirm"), { target: { value: "stock" } }); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Apply inventory adjustment" }));
  await waitFor(() => expect(posts()).toHaveLength(1)); expect(posts()[0]).toMatchObject({ action: "stock", version: 3, inventoryVersion: 7, delta: -3, confirmed: true });
});
it("keeps an uncertain mutation and retries the exact UUID/body after an absent receipt is confirmed", async () => {
  let writes = 0; (fetch as jest.Mock).mockImplementation(async (url, init) => { if (init?.method === "POST" && ++writes === 1) throw new Error("Connection interrupted"); return initialFetch(url, init); });
  view(); await choose(); fireEvent.change(screen.getByLabelText("Product name"), { target: { value: "Retained draft" } }); fireEvent.click(screen.getByRole("button", { name: "Save catalog content for review" }));
  await screen.findByText("Connection interrupted"); const retry = screen.getByRole("button", { name: "Retry original request" }); expect(retry).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "Reload saved catalog / receipt" })); await waitFor(() => expect(retry).toHaveProperty("disabled", false)); expect(screen.getByLabelText("Product name")).toHaveProperty("value", "Retained draft");
  fireEvent.click(retry); await waitFor(() => expect(posts()).toHaveLength(2)); expect(posts()[0]).toEqual(posts()[1]); await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
});
it("resolves a recorded request from its receipt without sending the mutation again", async () => {
  let written = false; (fetch as jest.Mock).mockImplementation(async (url, init) => { if (init?.method === "POST") { written = true; throw new Error("Receipt response lost"); } if (written && url.includes("requestId=")) return response(page({ attempt: { id: row.id }, attemptedRow: { ...row, catalogVersion: 4, name: "Saved title" } })); return initialFetch(url, init); });
  view(); await choose(); fireEvent.change(screen.getByLabelText("Product name"), { target: { value: "Saved title" } }); fireEvent.click(screen.getByRole("button", { name: "Save catalog content for review" })); await screen.findByText("Receipt response lost"); fireEvent.click(screen.getByRole("button", { name: "Reload saved catalog / receipt" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Retry original request" })).toBeNull()); expect(posts()).toHaveLength(1); expect(screen.getByLabelText("Product name")).toHaveProperty("value", "Saved title");
});
it("does not silently replace invalid legacy specifications or hide a failed taxonomy lookup", async () => {
  (fetch as jest.Mock).mockImplementation(async (url, init) => url === "/api/categories" ? response({ success: false }, 503) : url.startsWith("/api/member/products") ? response(page({ rows: [{ ...row, specifications: { unsupported: true } }] })) : initialFetch(url, init));
  view(); await choose(); expect(screen.getByText(/Saved selections remain available/)).toBeTruthy(); expect(screen.getByRole("button", { name: "Save catalog content for review" })).toHaveProperty("disabled", true); expect(screen.getByText(/will not be silently replaced/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Replace invalid specifications with an empty list" })); expect(screen.getByRole("button", { name: "Save catalog content for review" })).toHaveProperty("disabled", false);
});
it("requires explicit resubmission of an archive rather than offering another archive action", async () => {
  (fetch as jest.Mock).mockImplementation(async (url, init) => url.startsWith("/api/member/products") ? response(page({ rows: [{ ...row, status: "ARCHIVED" }] })) : initialFetch(url, init));
  view(); await choose(); expect(screen.queryByRole("button", { name: "Archive saved product" })).toBeNull(); fireEvent.change(screen.getByLabelText("Operation to confirm"), { target: { value: "resubmit" } }); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Restore and submit for review" })); await waitFor(() => expect(posts()).toHaveLength(1)); expect(posts()[0]).toMatchObject({ action: "resubmit", version: 3, confirmed: true });
});
it("aborts private data work and removes the editor when the current owner changes", async () => {
  let finish!: (value: Response) => void; (fetch as jest.Mock).mockImplementation((url, init) => url.startsWith("/api/member/products") ? new Promise<Response>((resolve) => { finish = resolve; }) : initialFetch(url, init));
  view(); await waitFor(() => expect(finish).toBeDefined()); const signal = (fetch as jest.Mock).mock.calls.find(([url]) => url.startsWith("/api/member/products"))[1].signal;
  act(() => useAuthStore.setState({ user: null })); expect(signal.aborted).toBe(true); await act(async () => finish(response(page()))); expect(screen.queryByRole("button", { name: "Edit Original gadget" })).toBeNull();
});
