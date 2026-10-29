/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminProductManageActions } from "../../app/(dashboard)/admin/_components/admin-product-manage-actions";
import { adminUpdateProductPrice, updateProductStatus, adminDeleteProduct } from "../../server/actions/admin/admin-actions";

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
jest.mock("@/server/actions/admin/admin-actions", () => ({ adminUpdateProductPrice: jest.fn(), updateProductStatus: jest.fn(), adminDeleteProduct: jest.fn() }));
beforeEach(() => { jest.clearAllMocks(); });
const view = () => render(<AdminProductManageActions productId="product-1" currentPrice={100} currentDiscountPrice={null} currentStatus="PENDING_APPROVAL" />);

it("validates discounts locally and keeps backend price failures visible without claiming success", async () => {
  (adminUpdateProductPrice as jest.Mock).mockResolvedValue({ success: false, error: "Administrator access changed. Sign in again." });
  view(); fireEvent.click(screen.getByRole("button", { name: "Edit Price" }));
  fireEvent.change(screen.getByLabelText("Discount Price"), { target: { value: "150" } });
  fireEvent.submit(screen.getByRole("form", { name: "Edit product price" }));
  expect(screen.getByRole("alert").textContent).toMatch(/lower/); expect(adminUpdateProductPrice).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Discount Price"), { target: { value: "50" } });
  fireEvent.submit(screen.getByRole("form", { name: "Edit product price" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/access changed/));
  expect(screen.queryByRole("status")).toBeNull(); expect(refresh).not.toHaveBeenCalled();
  expect(screen.getByRole("form", { name: "Edit product price" })).toBeTruthy();
});
it("uses explicit null to clear discounts and refreshes only after a confirmed save", async () => {
  (adminUpdateProductPrice as jest.Mock).mockResolvedValue({ success: true, data: { price: 99.99, discountPrice: null } });
  view(); fireEvent.click(screen.getByRole("button", { name: "Edit Price" }));
  fireEvent.change(screen.getByLabelText("Price (BDT)"), { target: { value: "99.99" } });
  fireEvent.submit(screen.getByRole("form", { name: "Edit product price" }));
  await waitFor(() => expect(adminUpdateProductPrice).toHaveBeenCalledWith("product-1", 99.99, null));
  expect(await screen.findByRole("status")).toHaveProperty("textContent", "Price saved."); expect(refresh).toHaveBeenCalledTimes(1);
});
it("surfaces rejected status and protected-delete results without a false success or reload", async () => {
  (updateProductStatus as jest.Mock).mockResolvedValue({ success: false, error: "Correct the product fields and cover/gallery before approval." });
  (adminDeleteProduct as jest.Mock).mockResolvedValue({ success: false, error: "This record is referenced by other records and cannot be deleted." });
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
  try {
    view(); fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/before approval/));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/cannot be deleted/));
    expect(screen.queryByRole("status")).toBeNull(); expect(refresh).not.toHaveBeenCalled();
  } finally { confirm.mockRestore(); }
});
