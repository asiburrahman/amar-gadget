/** @jest-environment jsdom */
import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TaxonomyConsole } from "@/components/admin/taxonomy-console";
import { useAuthStore } from "@/stores/auth-store";
import { uploadProductImage } from "@/lib/client/product-image-upload";
const mockRefresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
jest.mock("@/lib/client/product-image-upload", () => ({ uploadProductImage: jest.fn() }));
const admin = { id: "admin", name: "Admin", email: "admin@example.invalid", role: "ADMIN", avatar: null, isVerified: true };
const row = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Phones", slug: "phones", image: null as string | null, version: 1, parentId: null as string | null, parentName: null as string | null, path: ["Phones"], productsCount: 0, childrenCount: 0 };
const page = (rows = [row], kind = "category", mode = "list") => ({ success: true, ownerId: admin.id, kind, mode, rows, events: [], page: 1, total: rows.length, totalPages: 1, attempt: null });
const response = (value: unknown, status = 200) => ({ ok: status < 300, status, json: async () => value }) as Response;
const posts = () => (fetch as jest.Mock).mock.calls.filter(([, value]) => value.method === "POST").map(([, value]) => JSON.parse(value.body));
beforeEach(() => { jest.clearAllMocks(); useAuthStore.setState({ user: admin, loading: false, fetchUser: jest.fn().mockResolvedValue(admin) }); global.fetch = jest.fn().mockResolvedValue(response(page())); });
it("loads once in StrictMode and submits the saved category revision, explicit parent and original request UUID", async () => {
  let saved = row;
  (fetch as jest.Mock).mockImplementation(async (url, init) => { if (init.method === "POST") { const body = JSON.parse(init.body); saved = { ...row, ...body.fields, path: [body.fields.name], version: 2 }; return response({ success: true, ownerId: admin.id, result: { kind: "category", id: row.id, version: 2, deleted: false } }); } return response(page([saved], "category", String(url).includes("mode=record") ? "record" : "list")); });
  render(<StrictMode><TaxonomyConsole ownerId={admin.id} kind="category" /></StrictMode>);
  fireEvent.click(await screen.findByRole("button", { name: "Edit Phones" })); expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText("Catalog name"), { target: { value: "Mobile Phones" } }); fireEvent.change(screen.getByLabelText("Catalog URL slug"), { target: { value: "mobile-phones" } });
  fireEvent.click(screen.getByRole("button", { name: "Save category details" }));
  await waitFor(() => expect(mockRefresh).toHaveBeenCalled()); await screen.findByRole("heading", { name: "Edit Mobile Phones" });
  expect(posts()).toEqual([{ action: "update", kind: "category", id: row.id, version: 1, requestId: expect.any(String), fields: { name: "Mobile Phones", slug: "mobile-phones", parentId: null } }]);
});
it("retains an uncertain edit and retries exactly the same body only after a confirmed reload", async () => {
  let attempts = 0;
  (fetch as jest.Mock).mockImplementation(async (_url, init) => { if (init.method === "GET") return response(page()); attempts++; if (attempts === 1) throw new Error("Response lost"); return response({ success: true, ownerId: admin.id, result: { kind: "category", id: row.id, version: 2, deleted: false } }); });
  render(<TaxonomyConsole ownerId={admin.id} kind="category" />); fireEvent.click(await screen.findByRole("button", { name: "Edit Phones" })); fireEvent.change(screen.getByLabelText("Catalog name"), { target: { value: "Keep this intended name" } }); fireEvent.click(screen.getByRole("button", { name: "Save category details" })); await screen.findByText("Response lost");
  expect(screen.getByLabelText("Catalog name")).toHaveProperty("value", "Keep this intended name"); expect(screen.getByRole("button", { name: "Retry original change" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "Reload saved catalog" })); await waitFor(() => expect(screen.getByRole("button", { name: "Retry original change" })).toHaveProperty("disabled", false)); fireEvent.click(screen.getByRole("button", { name: "Retry original change" }));
  await waitFor(() => expect(posts()).toHaveLength(2)); expect(posts()[1]).toEqual(posts()[0]);
});
it("finds the committed original receipt after a lost response without issuing another mutation", async () => {
  let recorded = false;
  (fetch as jest.Mock).mockImplementation(async (url, init) => { if (init.method === "POST") { recorded = true; throw new Error("Uncertain write"); } return response({ ...page(), ...(recorded && String(url).includes("requestId=") ? { attempt: { kind: "category", id: row.id, version: 2, deleted: false } } : {}) }); });
  render(<TaxonomyConsole ownerId={admin.id} kind="category" />); fireEvent.click(await screen.findByRole("button", { name: "Edit Phones" })); fireEvent.click(screen.getByRole("button", { name: "Save category details" })); await screen.findByText("Uncertain write"); fireEvent.click(screen.getByRole("button", { name: "Reload saved catalog" }));
  await screen.findByText("The original change is already recorded in the saved catalog."); await waitFor(() => expect(screen.queryByRole("button", { name: "Retry original change" })).toBeNull()); expect(posts()).toHaveLength(1);
});
it("queries a bounded parent list excluding the edited subtree and sends the selected parent ID", async () => {
  const child = { ...row, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Cases", path: ["Phones", "Cases"], parentId: row.id, parentName: "Phones" }, alternative = { ...row, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Tablets", path: ["Tablets"] };
  (fetch as jest.Mock).mockImplementation(async (url, init) => init.method === "POST" ? response({ success: true, ownerId: admin.id, result: { kind: "category", id: child.id, version: 2, deleted: false } }) : response(String(url).includes("mode=parents") ? page([alternative], "category", "parents") : page([child])));
  render(<TaxonomyConsole ownerId={admin.id} kind="category" />); fireEvent.click(await screen.findByRole("button", { name: "Edit Cases" })); fireEvent.click(screen.getByRole("button", { name: "Find parent categories" })); await screen.findByRole("option", { name: "Tablets" });
  expect((fetch as jest.Mock).mock.calls.find(([url]) => String(url).includes("mode=parents"))[0]).toContain(`id=${child.id}`);
  fireEvent.change(screen.getByLabelText("Selected parent"), { target: { value: alternative.id } }); fireEvent.click(screen.getByRole("button", { name: "Save category details" })); await waitFor(() => expect(posts()[0]?.fields.parentId).toBe(alternative.id));
});
it("uploads through the real client-upload contract and publishes only the returned owned key and observed revision", async () => {
  const key = "products/admin/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png", image = new File([new Uint8Array([137, 80, 78, 71])], "logo.png", { type: "image/png" });
  (uploadProductImage as jest.Mock).mockResolvedValue({ fileKey: key, publicUrl: `https://cdn.example.invalid/${key}` });
  (fetch as jest.Mock).mockImplementation(async (_url, init) => init.method === "POST" ? response({ success: true, ownerId: admin.id, result: { kind: "category", id: row.id, version: 2, deleted: false } }) : response(page()));
  render(<TaxonomyConsole ownerId={admin.id} kind="category" />); fireEvent.click(await screen.findByRole("button", { name: "Edit Phones" })); fireEvent.change(screen.getByLabelText("Catalog image file"), { target: { files: [image] } }); fireEvent.click(screen.getByRole("button", { name: "Upload and publish image" }));
  await waitFor(() => expect(posts()).toHaveLength(1)); expect(posts()[0]).toEqual({ action: "image", kind: "category", id: row.id, version: 1, requestId: expect.any(String), uploadKey: key }); expect(uploadProductImage).toHaveBeenCalledWith(image, expect.any(AbortSignal), expect.any(Function));
});
it("aborts old-account image work and ignores a late upload response after account switching", async () => {
  let finish!: (value: { fileKey: string; publicUrl: string }) => void;
  (uploadProductImage as jest.Mock).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<TaxonomyConsole ownerId={admin.id} kind="category" />); fireEvent.click(await screen.findByRole("button", { name: "Edit Phones" })); fireEvent.change(screen.getByLabelText("Catalog image file"), { target: { files: [new File(["isolated"], "image.png", { type: "image/png" })] } }); fireEvent.click(screen.getByRole("button", { name: "Upload and publish image" }));
  const signal = (uploadProductImage as jest.Mock).mock.calls[0][1]; act(() => useAuthStore.setState({ user: null })); expect(signal.aborted).toBe(true);
  await act(async () => finish({ fileKey: "products/admin/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png", publicUrl: "https://cdn.example.invalid/image.png" })); expect(posts()).toHaveLength(0); expect(screen.queryByLabelText("Catalog name")).toBeNull();
});
it("requires explicit revision-bound deletion and exposes no mutation controls for another account", async () => {
  (fetch as jest.Mock).mockImplementation(async (_url, init) => init.method === "POST" ? response({ success: true, ownerId: admin.id, result: { kind: "category", id: row.id, version: 1, deleted: true } }) : response(page()));
  render(<TaxonomyConsole ownerId={admin.id} kind="category" />); fireEvent.click(await screen.findByRole("button", { name: "Edit Phones" })); const remove = screen.getByRole("button", { name: "Delete selected category" }); expect(remove).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("checkbox", { name: /I intend to delete/ })); fireEvent.click(remove); await waitFor(() => expect(posts()).toHaveLength(1)); expect(posts()[0]).toEqual({ action: "delete", kind: "category", id: row.id, version: 1, requestId: expect.any(String) });
  act(() => useAuthStore.setState({ user: { ...admin, id: "other-admin" } })); expect(screen.queryByLabelText("Catalog name")).toBeNull();
});
it("uses brand fields without a category parent control", async () => {
  (fetch as jest.Mock).mockResolvedValue(response(page([row], "brand"))); render(<TaxonomyConsole ownerId={admin.id} kind="brand" />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit Phones" })); expect(screen.queryByLabelText("Selected parent")).toBeNull(); expect(screen.getByRole("heading", { name: "Brand logo" })).toBeTruthy();
});
