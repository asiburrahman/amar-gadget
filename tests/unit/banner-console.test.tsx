/** @jest-environment jsdom */
import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BannerConsole } from "@/components/admin/banner-console";
import { useAuthStore } from "@/stores/auth-store";
import { uploadProductImage } from "@/lib/client/product-image-upload";
jest.mock("@/lib/client/product-image-upload", () => ({ uploadProductImage: jest.fn() }));
const admin = { id: "admin", name: "Admin", email: "admin@example.invalid", role: "ADMIN", avatar: null, isVerified: true };
const row = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "Saved banner", subtitle: null, imageUrl: "/images/banner.png", linkUrl: "/products", placement: "HERO", position: 1, version: 1, isActive: true, createdAt: "2026-11-02T00:00:00.000Z", updatedAt: "2026-11-02T00:00:00.000Z" };
const key = "products/admin/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png";
const page = () => ({ success: true, ownerId: admin.id, rows: [row], events: [], total: 1, page: 1, totalPages: 1, attempt: null, attemptedRow: null, attemptedDeleted: null });
const response = (value: unknown, status = 200) => ({ ok: status < 300, status, json: async () => value }) as Response;
const saved = (data = row) => ({ success: true, ownerId: admin.id, result: { id: data.id, version: data.version, deleted: false }, row: data, currentDeleted: false });
const posts = () => (fetch as jest.Mock).mock.calls.filter(([, value]) => value.method === "POST").map(([, value]) => JSON.parse(value.body));
beforeEach(() => { jest.clearAllMocks(); useAuthStore.setState({ user: admin, loading: false, fetchUser: jest.fn().mockResolvedValue(admin) }); global.fetch = jest.fn().mockImplementation(async (_url, init) => response(init.method === "POST" ? saved({ ...row, version: 2 }) : page())); (uploadProductImage as jest.Mock).mockResolvedValue({ fileKey: key, publicUrl: `https://cdn.example.invalid/${key}` }); });
it("loads once in StrictMode and edits placement/order with the observed revision without replacing an image", async () => {
  render(<StrictMode><BannerConsole ownerId={admin.id} /></StrictMode>); fireEvent.click(await screen.findByRole("button", { name: "Edit Saved banner" })); expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText("Placement"), { target: { value: "AD" } }); fireEvent.change(screen.getByLabelText("Position"), { target: { value: "20" } }); fireEvent.click(screen.getByRole("button", { name: "Save banner details" }));
  await waitFor(() => expect(posts()).toHaveLength(1)); expect(posts()[0]).toMatchObject({ action: "update", id: row.id, version: 1, requestId: expect.any(String), fields: { placement: "AD", position: 20 } }); expect(uploadProductImage).not.toHaveBeenCalled();
});
it("uses the actual upload contract for create and submits only its owned key", async () => {
  render(<BannerConsole ownerId={admin.id} />); await screen.findByRole("button", { name: "Edit Saved banner" }); fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New campaign" } }); fireEvent.change(screen.getByLabelText("Banner image"), { target: { files: [new File(["image bytes"], "banner.png", { type: "image/png" })] } }); fireEvent.click(screen.getByRole("button", { name: "Upload and create banner" }));
  await waitFor(() => expect(posts()).toHaveLength(1)); expect(uploadProductImage).toHaveBeenCalledWith(expect.any(File), expect.any(AbortSignal), expect.any(Function)); expect(posts()[0]).toEqual({ action: "create", requestId: expect.any(String), uploadKey: key, fields: { title: "New campaign", subtitle: null, linkUrl: null, placement: "HERO", position: 0, isActive: false } });
});
it("keeps uncertain intent and retries exactly without uploading a second image after receipt lookup", async () => {
  let writes = 0; (fetch as jest.Mock).mockImplementation(async (_url, init) => { if (init.method === "GET") return response(page()); if (++writes === 1) throw new Error("Response lost"); return response(saved({ ...row, version: 2 })); });
  render(<BannerConsole ownerId={admin.id} />); fireEvent.click(await screen.findByRole("button", { name: "Edit Saved banner" })); fireEvent.change(screen.getByLabelText("Banner image"), { target: { files: [new File(["image"], "banner.png", { type: "image/png" })] } }); fireEvent.click(screen.getByRole("button", { name: "Upload and replace image" })); await screen.findByText("Response lost"); expect(screen.getByRole("button", { name: "Retry original request" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "Reload saved banners / receipt" })); await waitFor(() => expect(screen.getByRole("button", { name: "Retry original request" })).toHaveProperty("disabled", false)); fireEvent.click(screen.getByRole("button", { name: "Retry original request" })); await waitFor(() => expect(posts()).toHaveLength(2)); expect(posts()[0]).toEqual(posts()[1]); expect(uploadProductImage).toHaveBeenCalledTimes(1);
});
it("recovers a committed original edit after another administrator deleted the banner", async () => {
  let recorded = false; (fetch as jest.Mock).mockImplementation(async (url, init) => { if (init.method === "POST") { recorded = true; throw new Error("Receipt lost"); } return response({ ...page(), ...(recorded && String(url).includes("requestId=") ? { attempt: { id: row.id, version: 2, deleted: false }, attemptedRow: null, attemptedDeleted: true } : {}) }); });
  render(<BannerConsole ownerId={admin.id} />); fireEvent.click(await screen.findByRole("button", { name: "Edit Saved banner" })); fireEvent.click(screen.getByRole("button", { name: "Save banner details" })); await screen.findByText("Receipt lost"); fireEvent.click(screen.getByRole("button", { name: "Reload saved banners / receipt" })); await screen.findByText("The original request is recorded. Current saved state loaded."); expect(posts()).toHaveLength(1); expect(screen.getByRole("heading", { name: "Create banner" })).toBeTruthy();
});
it("requires explicit revision-bound deletion and invalidates its confirmation when fields change", async () => {
  render(<BannerConsole ownerId={admin.id} />); fireEvent.click(await screen.findByRole("button", { name: "Edit Saved banner" })); const remove = screen.getByRole("button", { name: "Delete selected banner" }); expect(remove).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("checkbox", { name: /I intend to delete/ })); fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Keep this draft" } }); expect(remove).toHaveProperty("disabled", true); fireEvent.click(screen.getByRole("checkbox", { name: /I intend to delete/ })); fireEvent.click(remove); await waitFor(() => expect(posts()).toHaveLength(1)); expect(posts()[0]).toEqual({ action: "delete", id: row.id, version: 1, requestId: expect.any(String) });
});
it("aborts uploads on account switch and never publishes a late upload key", async () => {
  let finish!: (value: { fileKey: string; publicUrl: string }) => void; (uploadProductImage as jest.Mock).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<BannerConsole ownerId={admin.id} />); fireEvent.click(await screen.findByRole("button", { name: "Edit Saved banner" })); fireEvent.change(screen.getByLabelText("Banner image"), { target: { files: [new File(["image"], "banner.png", { type: "image/png" })] } }); fireEvent.click(screen.getByRole("button", { name: "Upload and replace image" })); const signal = (uploadProductImage as jest.Mock).mock.calls[0][1];
  act(() => useAuthStore.setState({ user: null })); expect(signal.aborted).toBe(true); await act(async () => finish({ fileKey: key, publicUrl: `https://cdn.example.invalid/${key}` })); expect(posts()).toHaveLength(0); expect(screen.queryByLabelText("Title")).toBeNull();
});
it("retains an open draft on list reload and rejects an unsafe link before any write", async () => {
  render(<BannerConsole ownerId={admin.id} />); fireEvent.click(await screen.findByRole("button", { name: "Edit Saved banner" })); fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Typed title" } }); fireEvent.click(screen.getByRole("button", { name: "Reload saved banners / receipt" })); await waitFor(() => expect(screen.getByRole("button", { name: "Save banner details" })).toHaveProperty("disabled", false)); expect(screen.getByLabelText("Title")).toHaveProperty("value", "Typed title");
  fireEvent.change(screen.getByLabelText("Storefront link (optional)"), { target: { value: "javascript:alert(1)" } }); fireEvent.click(screen.getByRole("button", { name: "Save banner details" })); await screen.findByText("Use a public storefront path beginning with a single slash."); expect(posts()).toHaveLength(0);
});
