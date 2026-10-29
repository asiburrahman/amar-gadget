/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { WishlistView } from "@/components/account/wishlist-view";
import { useWishlistStore } from "@/stores/wishlist-store";
import { useCartStore } from "@/stores/cart-store";
const entry = { id: "actual-product", product: { id: "actual-product", slug: "actual-product", name: "Actual gadget", price: 100, discountPrice: 80, stock: 2, imageUrl: "https://cdn.example.invalid/product.png", category: "Phones" } };
const clear = jest.fn().mockResolvedValue(true), remove = jest.fn().mockResolvedValue(true);
beforeEach(() => { jest.clearAllMocks(); useCartStore.setState({ items: [] }); useWishlistStore.setState({ scope: "account:owner", items: [entry], status: "ready", busy: false, refreshing: false, error: "", version: 5, clearWishlist: clear, removeItem: remove }); });
it("renders actual prices and custom-CDN media and adds the real stock to cart without a fabricated ten", () => {
  render(<WishlistView />); expect(screen.getByText(/80\.00/)).toBeTruthy(); expect(screen.getByRole("img").getAttribute("src")).toBe(entry.product.imageUrl);
  fireEvent.click(screen.getByRole("button", { name: "Add Actual gadget to cart" }));
  expect(useCartStore.getState().items[0]).toMatchObject({ id: entry.id, stock: 2, price: 100, discountPrice: 80 });
});
it("keeps hidden product metadata absent and prevents adding unavailable stock", () => {
  useWishlistStore.setState({ items: [{ id: "hidden-product", product: null }, { ...entry, product: { ...entry.product, stock: 0 } }] });
  render(<WishlistView />); expect(screen.getByText("Product unavailable")).toBeTruthy(); expect(screen.getByRole("button", { name: "Add Actual gadget to cart" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "Remove saved product hidden-product" })); expect(remove).toHaveBeenCalledWith("hidden-product");
});
it("requires clear confirmation and does not label loading or failed snapshots as empty lists", async () => {
  const view = render(<WishlistView />); fireEvent.click(screen.getByRole("button", { name: "Clear wishlist" })); expect(clear).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm clear wishlist" })); expect(clear).toHaveBeenCalledTimes(1);
  view.unmount(); useWishlistStore.setState({ items: [], status: "error", error: "Sync unavailable" }); render(<WishlistView />);
  expect(screen.getByRole("alert").textContent).toBe("Sync unavailable"); expect(screen.queryByText("Your wishlist is empty.")).toBeNull();
});
