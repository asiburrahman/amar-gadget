/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProductGalleryEditor } from "@/components/catalog/product-gallery-editor";
import { replaceProductGallery } from "@/server/actions/product/gallery-actions";
import type { ProductImageSelection } from "@/components/forms/product-image-picker";
const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
jest.mock("@/server/actions/product/gallery-actions", () => ({ replaceProductGallery: jest.fn() }));
jest.mock("@/components/forms/product-image-picker", () => ({ ProductImagePicker: ({ onChange, onCountChange, maxImages }: { onChange: (selection: ProductImageSelection) => void; onCountChange: (count: number) => void; maxImages: number }) => <><p>Available slots: {maxImages}</p><button type="button" onClick={() => { onCountChange(1); onChange({ keys: [], ready: false }); }}>Start test upload</button><button type="button" onClick={() => onChange({ keys: ["products/seller/00000000-0000-4000-8000-000000000001.png"], ready: true })}>Finish test upload</button></> }));
const urls = ["https://cdn.example.invalid/first.png", "https://cdn.example.invalid/second.png"];
beforeEach(() => { jest.clearAllMocks(); (replaceProductGallery as jest.Mock).mockResolvedValue({ success: false, error: "Gallery changed. Reload before editing." }); });
it("sends retained images in selected cover order and preserves selections when saving fails", async () => {
  render(<ProductGalleryEditor productId="product" version={4} urls={urls} />);
  fireEvent.change(screen.getByLabelText("Cover image"), { target: { value: `existing:${urls[1]}` } });
  fireEvent.click(screen.getByRole("button", { name: "Save gallery" }));
  await screen.findByRole("alert");
  expect(replaceProductGallery).toHaveBeenCalledWith({ productId: "product", version: 4, items: [{ source: "existing", url: urls[1] }, { source: "existing", url: urls[0] }] });
  expect(screen.getAllByRole("img")).toHaveLength(2); expect(refresh).not.toHaveBeenCalled();
});
it("accounts for saved images, waits for uploads and clears no state before a successful server commit", async () => {
  (replaceProductGallery as jest.Mock).mockResolvedValue({ success: true, data: { changed: true } });
  render(<ProductGalleryEditor productId="product" version={1} urls={urls} />);
  expect(screen.getByText("Available slots: 6")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove saved image 1" }));
  expect(screen.getByText("Available slots: 7")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Start test upload" }));
  expect(screen.getByRole("button", { name: "Save gallery" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "Finish test upload" }));
  fireEvent.click(screen.getByRole("button", { name: "Save gallery" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  expect((replaceProductGallery as jest.Mock).mock.calls[0][0].items).toHaveLength(2);
  expect(screen.getByRole("status").textContent).toContain("awaiting approval");
});
it("reports a no-op without claiming that an approved product became pending", async () => {
  (replaceProductGallery as jest.Mock).mockResolvedValue({ success: true, data: { changed: false } });
  render(<ProductGalleryEditor productId="product" version={1} urls={urls} />);
  fireEvent.click(screen.getByRole("button", { name: "Save gallery" }));
  expect((await screen.findByRole("status")).textContent).toContain("approval status is preserved");
});
