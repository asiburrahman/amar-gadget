/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AddProductPage from "../../app/(dashboard)/member/add-product/page";
import { ProductImagePicker } from "../../components/forms/product-image-picker";
import { ProductGallery } from "../../components/shared/product-gallery";
import { uploadProductImage } from "../../lib/client/product-image-upload";
import { createProduct } from "../../server/actions/product/product-actions";

const navigation = { push: jest.fn() };
jest.mock("next/navigation", () => ({ useRouter: () => navigation }));
jest.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "seller", role: "MEMBER", sellerStatus: "APPROVED" }, loading: false }) }));
jest.mock("@/server/actions/product/product-actions", () => ({ createProduct: jest.fn(), getCategories: jest.fn().mockResolvedValue({ success: true, data: [{ id: "category", name: "Phones" }] }), getBrands: jest.fn().mockResolvedValue({ success: true, data: [] }) }));

class UploadXhr {
  static instances: UploadXhr[] = [];
  constructor() { UploadXhr.instances.push(this); }
  status = 0; timeout = 0; withCredentials = false;
  upload: { onprogress?: (event: ProgressEvent) => void } = {};
  onload?: () => void; onerror?: () => void; ontimeout?: () => void; onabort?: () => void;
  headers: Record<string, string> = {};
  open = jest.fn(); send = jest.fn();
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  abort = jest.fn(() => this.onabort?.());
  finish(status = 200) { this.status = status; this.onload?.(); }
}
const originalXhr = global.XMLHttpRequest;
const originalFetch = global.fetch;
const key = (id: number) => `products/seller/00000000-0000-4000-8000-${String(id).padStart(12, "0")}.png`;
beforeEach(() => {
  jest.clearAllMocks(); UploadXhr.instances = [];
  global.XMLHttpRequest = UploadXhr as unknown as typeof XMLHttpRequest;
  let sequence = 0;
  global.fetch = jest.fn().mockImplementation(async () => { const id = ++sequence; return { ok: true, json: async () => ({ success: true, uploadUrl: `https://r2.example.invalid/upload-${id}`, fileKey: key(id), publicUrl: `https://media.example.invalid/${id}.png`, headers: { "Content-Type": "image/png", "If-None-Match": "*" } }) }; });
  URL.createObjectURL = jest.fn((file: Blob) => `blob:local/${file.size}/${Math.random()}`);
  URL.revokeObjectURL = jest.fn();
  (createProduct as jest.Mock).mockResolvedValue({ success: false, error: "Submission fixture stopped after inspecting the payload." });
});
afterAll(() => { global.XMLHttpRequest = originalXhr; global.fetch = originalFetch; });
const file = (name = "phone.png", size = 128) => new File([new Uint8Array(size)], name, { type: "image/png" });
const choose = (files: File[]) => fireEvent.change(screen.getByLabelText("Add product images"), { target: { files } });
const finish = async (index: number, status = 200) => { await act(async () => UploadXhr.instances[index].finish(status)); };

it("sends a 3 MiB File directly through PUT and keeps the application request metadata-only", async () => {
  const image = file("large.png", 3 * 1024 * 1024);
  const progress = jest.fn();
  const promise = uploadProductImage(image, new AbortController().signal, progress);
  await waitFor(() => expect(UploadXhr.instances).toHaveLength(1));
  const xhr = UploadXhr.instances[0];
  expect(xhr.send).toHaveBeenCalledWith(image); expect(xhr.open).toHaveBeenCalledWith("PUT", "https://r2.example.invalid/upload-1");
  expect(xhr.headers["If-None-Match"]).toBe("*"); expect(xhr.withCredentials).toBe(false);
  expect((fetch as jest.Mock).mock.calls[0][1].body.length).toBeLessThan(100);
  xhr.upload.onprogress?.(new ProgressEvent("progress", { lengthComputable: true, loaded: 50, total: 100 })); expect(progress).toHaveBeenLastCalledWith(50);
  xhr.finish(); await expect(promise).resolves.toMatchObject({ fileKey: key(1) }); expect(progress).toHaveBeenLastCalledWith(100);
});
it("blocks form submission until the gallery uploads finish, persists cover order and never sends inline bytes", async () => {
  render(<AddProductPage />);
  await screen.findByRole("option", { name: "Phones" });
  const submit = screen.getByRole("button", { name: "Submit Product For Admin Approval" });
  expect(submit).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByLabelText("Product Title / Name *"), { target: { value: "Real phone" } });
  fireEvent.change(screen.getByLabelText("Price (BDT) *"), { target: { value: "100" } });
  fireEvent.change(screen.getByLabelText("Category *"), { target: { value: "category" } });
  fireEvent.click(screen.getByRole("button", { name: "Add specification" }));
  fireEvent.change(screen.getByLabelText("Specification 1"), { target: { value: "Screen" } });
  fireEvent.change(screen.getByLabelText("Value 1"), { target: { value: "OLED" } });
  choose([file("first.png"), file("second.png")]);
  await waitFor(() => expect(UploadXhr.instances).toHaveLength(1));
  expect(submit).toHaveProperty("disabled", true); await finish(0);
  await waitFor(() => expect(UploadXhr.instances).toHaveLength(2)); await finish(1);
  await waitFor(() => expect(submit).toHaveProperty("disabled", false));
  fireEvent.click(screen.getByRole("button", { name: "Use image 2 as cover" }));
  fireEvent.click(submit);
  await waitFor(() => expect(createProduct).toHaveBeenCalledTimes(1));
  const payload = (createProduct as jest.Mock).mock.calls[0][0];
  expect(payload.uploadKeys).toEqual([key(2), key(1)]);
  expect(payload.specifications).toEqual([{ label: "Screen", value: "OLED" }]);
  expect(payload.images).toEqual([]); expect(payload.imageUrl).toBeUndefined(); expect(JSON.stringify(payload)).not.toContain("base64");
});
it("shows provider rejection and retries with a fresh upload before enabling submission", async () => {
  const changed = jest.fn(); render(<ProductImagePicker disabled={false} onChange={changed} />);
  choose([file()]); await waitFor(() => expect(UploadXhr.instances).toHaveLength(1)); await finish(0, 403);
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Storage rejected the upload. Retry to request a fresh upload URL.");
  expect(changed).toHaveBeenLastCalledWith({ keys: [], ready: false });
  fireEvent.click(screen.getByRole("button", { name: "Retry phone.png" }));
  await waitFor(() => expect(UploadXhr.instances).toHaveLength(2)); await finish(1);
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith({ keys: [key(2)], ready: true }));
});
it("shows the actual seller form's successful pending-approval state, blocks resubmission and navigates once", async () => {
  (createProduct as jest.Mock).mockResolvedValue({ success: true, data: { id: "saved-product", slug: "saved-product" } });
  render(<AddProductPage />); await screen.findByRole("option", { name: "Phones" });
  fireEvent.change(screen.getByLabelText("Product Title / Name *"), { target: { value: "Real phone" } });
  fireEvent.change(screen.getByLabelText("Price (BDT) *"), { target: { value: "100" } });
  fireEvent.change(screen.getByLabelText("Category *"), { target: { value: "category" } });
  choose([file()]); await waitFor(() => expect(UploadXhr.instances).toHaveLength(1)); await finish(0);
  jest.useFakeTimers();
  try {
    const submit = screen.getByRole("button", { name: "Submit Product For Admin Approval" }), form = submit.closest("form")!;
    await act(async () => fireEvent.submit(form));
    expect(screen.getAllByRole("status").some((node) => node.textContent?.includes("Sent to Admin for approval"))).toBe(true);
    expect(submit).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Product details")).toHaveProperty("disabled", true);
    await act(async () => fireEvent.submit(form));
    expect(createProduct).toHaveBeenCalledTimes(1); expect(navigation.push).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(2000)); expect(navigation.push).toHaveBeenCalledTimes(1); expect(navigation.push).toHaveBeenCalledWith("/member/dashboard");
  } finally { jest.useRealTimers(); }
});
it("cancels a pending success navigation when the seller leaves the page", async () => {
  (createProduct as jest.Mock).mockResolvedValue({ success: true, data: { id: "saved-product", slug: "saved-product" } });
  const view = render(<AddProductPage />); await screen.findByRole("option", { name: "Phones" });
  fireEvent.change(screen.getByLabelText("Product Title / Name *"), { target: { value: "Real phone" } });
  fireEvent.change(screen.getByLabelText("Price (BDT) *"), { target: { value: "100" } });
  fireEvent.change(screen.getByLabelText("Category *"), { target: { value: "category" } });
  choose([file()]); await waitFor(() => expect(UploadXhr.instances).toHaveLength(1)); await finish(0);
  jest.useFakeTimers();
  try {
    await act(async () => fireEvent.submit(screen.getByRole("button", { name: "Submit Product For Admin Approval" }).closest("form")!));
    view.unmount(); act(() => jest.advanceTimersByTime(2000)); expect(navigation.push).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});
it("rejects fractional stock and excessive discounts in the actual seller form instead of truncating them", async () => {
  render(<AddProductPage />); await screen.findByRole("option", { name: "Phones" });
  fireEvent.change(screen.getByLabelText("Product Title / Name *"), { target: { value: "Real phone" } });
  fireEvent.change(screen.getByLabelText("Price (BDT) *"), { target: { value: "100" } });
  fireEvent.change(screen.getByLabelText("Category *"), { target: { value: "category" } });
  choose([file()]); await waitFor(() => expect(UploadXhr.instances).toHaveLength(1)); await finish(0);
  const form = screen.getByRole("button", { name: "Submit Product For Admin Approval" }).closest("form")!;
  fireEvent.change(screen.getByLabelText("Stock Quantity *"), { target: { value: "1.5" } });
  fireEvent.submit(form);
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy()); expect(createProduct).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Stock Quantity *"), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("Discount Offer Price (BDT)"), { target: { value: "150" } });
  fireEvent.submit(form);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/lower/)); expect(createProduct).not.toHaveBeenCalled();
});
it("cancels removed and unmounted uploads, releases local previews and permits reselection", async () => {
  const changed = jest.fn(); const view = render(<ProductImagePicker disabled={false} onChange={changed} />);
  choose([file()]); await waitFor(() => expect(UploadXhr.instances).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "Remove image 1" }));
  expect(UploadXhr.instances[0].abort).toHaveBeenCalledTimes(1); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenLastCalledWith({ keys: [], ready: false });
  choose([file()]); await waitFor(() => expect(UploadXhr.instances).toHaveLength(2)); view.unmount();
  expect(UploadXhr.instances[1].abort).toHaveBeenCalledTimes(1); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
});
it("rejects unsupported, oversized and excessive selections before requesting provider access", () => {
  render(<ProductImagePicker disabled={false} onChange={jest.fn()} />);
  for (const files of [[new File(["<svg/>"], "bad.svg", { type: "image/svg+xml" })], [file("large.png", 5 * 1024 * 1024 + 1)], Array.from({ length: 9 }, () => file())]) {
    choose(files); expect(screen.getByRole("alert")).toBeTruthy(); expect(fetch).not.toHaveBeenCalled();
  }
});
it("handles network failures and timeout without reporting successful upload", async () => {
  for (const event of ["onerror", "ontimeout"] as const) {
    const promise = uploadProductImage(file(), new AbortController().signal, jest.fn());
    const rejected = expect(promise).rejects.toThrow(event === "onerror" ? /failed/ : /timed out/);
    await waitFor(() => expect(UploadXhr.instances.at(-1)?.send).toHaveBeenCalled());
    UploadXhr.instances.at(-1)?.[event]?.(); await rejected;
  }
});
it("shows the saved cover and supports accessible gallery selection without duplicate thumbnails", () => {
  render(<ProductGallery name="Phone" imageUrl="https://media.example.invalid/cover.png" images={["https://media.example.invalid/cover.png", "https://media.example.invalid/back.png"]} />);
  expect(screen.getByRole("img", { name: "Phone — image 1" }).getAttribute("src")).toBe("https://media.example.invalid/cover.png");
  expect(screen.getAllByRole("button")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "View image 2 of Phone" }));
  expect(screen.getByRole("img", { name: "Phone — image 2" }).getAttribute("src")).toBe("https://media.example.invalid/back.png");
  expect(screen.getByRole("button", { name: "View image 2 of Phone" }).getAttribute("aria-pressed")).toBe("true");
});
