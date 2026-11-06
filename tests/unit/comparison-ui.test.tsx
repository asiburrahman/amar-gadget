/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CompareButton, ComparisonLink } from "@/components/catalog/compare-button";
import { ComparisonSelection } from "@/components/catalog/comparison-selection";
import { HeaderSearch } from "@/components/catalog/header-search";
import { AdminSpecificationEditor } from "@/components/catalog/admin-specification-editor";
import { adminUpdateSpecifications } from "@/server/actions/product/specification-actions";
import { useComparisonStore } from "@/stores/comparison-store";
import { act } from "react";
import { ElectroCategoryShowcase } from "@/components/categories/electro-category-showcase";

const push = jest.fn(), refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
jest.mock("next/form", () => ({ __esModule: true, default: (props: React.FormHTMLAttributes<HTMLFormElement>) => <form {...props} /> }));
jest.mock("@/server/actions/product/specification-actions", () => ({ adminUpdateSpecifications: jest.fn() }));
beforeEach(() => { useComparisonStore.getState().replace([]); jest.clearAllMocks(); });

it("selects/removes products, links the exact selection and reports the four-product limit", () => {
  render(<><ComparisonLink />{["a", "b", "c", "d", "e"].map((id) => <CompareButton key={id} productId={id} name={id} />)}</>);
  for (const id of ["a", "b", "c", "d", "e"]) fireEvent.click(screen.getByRole("button", { name: `Add ${id} to comparison` }));
  expect(screen.getByRole("alert").textContent).toContain("up to four");
  expect(screen.getByRole("link", { name: "Compare products (4 selected)" }).getAttribute("href")).toBe("/compare?product=a&product=b&product=c&product=d");
  fireEvent.click(screen.getByRole("button", { name: "Remove b from comparison" }));
  expect(screen.getByRole("button", { name: "Add b to comparison" }).getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Add e to comparison" }));
  expect(useComparisonStore.getState().ids).toEqual(["a", "c", "d", "e"]);
});
it("uses share URLs as the selection source and clears stored IDs explicitly", () => {
  render(<ComparisonSelection ids={["a", "b"]} />);
  expect(useComparisonStore.getState().ids).toEqual(["a", "b"]);
  expect(screen.getByRole("link", { name: "Remove product 1" }).getAttribute("href")).toBe("/compare?product=b");
  fireEvent.click(screen.getByRole("button", { name: "Clear comparison" }));
  expect(useComparisonStore.getState().ids).toEqual([]); expect(push).toHaveBeenCalledWith("/compare");
});
it("accumulates category showcase selections rather than replacing them with single-product links", () => {
  const products = ["a", "b"].map((id) => ({ id, name: `Gadget ${id}`, price: 100, stock: 1 }));
  render(<ElectroCategoryShowcase categories={[{ id: "category", name: "Phones", slug: "phones", products }]} allProducts={products} />);
  fireEvent.click(screen.getAllByRole("button", { name: "Add Gadget a to comparison" })[0]);
  fireEvent.click(screen.getAllByRole("button", { name: "Add Gadget b to comparison" })[0]);
  expect(useComparisonStore.getState().ids).toEqual(["a", "b"]);
});
it("validates persisted IDs and keeps working when browser storage throws", async () => {
  localStorage.setItem("amar-gadget-comparison", JSON.stringify({ state: { ids: ["a", "a"] }, version: 1 }));
  await act(() => useComparisonStore.persist.rehydrate()); expect(useComparisonStore.getState().ids).toEqual([]);
  const failure = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage disabled"); });
  expect(useComparisonStore.getState().add("a")).toBe(true); expect(useComparisonStore.getState().ids).toEqual(["a"]); failure.mockRestore();
});
it.each([false, true])("submits a real named search/category contract on mobile=%s", async (mobile) => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, items: [{ id: "cat", slug: "phones", name: "Phones" }] }) });
  render(<HeaderSearch mobile={mobile} />);
  const category = screen.getByLabelText("Search category (optional)"); fireEvent.focus(category);
  await waitFor(() => expect(screen.getByRole("option", { name: "Phones", hidden: true })).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Search products"), { target: { value: "OLED" } });
  fireEvent.change(category, { target: { value: "phones" } });
  const form = screen.getByRole("form"); const data = new FormData(form as HTMLFormElement);
  expect(form.getAttribute("action")).toBe("/search"); expect(data.get("q")).toBe("OLED"); expect(data.get("category")).toBe("phones");
});
it("keeps failed spec edits visible and reports success only after the action succeeds", async () => {
  (adminUpdateSpecifications as jest.Mock).mockResolvedValueOnce({ success: false, error: "Access changed" }).mockResolvedValueOnce({ success: true });
  render(<AdminSpecificationEditor productId="product" specifications={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit specifications" })); fireEvent.click(screen.getByRole("button", { name: "Add specification" }));
  fireEvent.change(screen.getByLabelText("Specification 1"), { target: { value: "Storage" } }); fireEvent.change(screen.getByLabelText("Value 1"), { target: { value: "512 GB" } });
  fireEvent.submit(screen.getByRole("form")); expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Access changed");
  expect(screen.getByLabelText("Value 1")).toHaveProperty("value", "512 GB"); expect(refresh).not.toHaveBeenCalled();
  fireEvent.submit(screen.getByRole("form")); expect(await screen.findByRole("status")).toHaveProperty("textContent", "Specifications saved."); expect(refresh).toHaveBeenCalledTimes(1);
});
