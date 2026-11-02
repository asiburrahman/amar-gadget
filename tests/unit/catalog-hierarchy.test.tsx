/** @jest-environment jsdom */
import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { categoryLabel, categoryProducts } from "@/lib/catalog-hierarchy";
import { ElectroCategoryShowcase } from "@/components/categories/electro-category-showcase";
import { useCatalogDepartments } from "@/hooks/use-catalog-departments";
const nodes = [
  { id: "phones", name: "Phones", slug: "phones", parentId: null, products: [] as { id: string }[] },
  { id: "cases", name: "Cases", slug: "phone-cases", parentId: "phones", products: [{ id: "one" }] },
  { id: "empty", name: "Empty", slug: "phone-empty", parentId: "phones", products: [] },
  { id: "laptops", name: "Laptops", slug: "laptops", parentId: null, products: [{ id: "two" }] },
];
it("labels complete ancestor paths and collects each descendant product once with cycle-safe traversal", () => {
  expect(categoryLabel(nodes[1], nodes)).toBe("Phones / Cases"); expect(categoryProducts("phones", nodes)).toEqual([{ id: "one" }]);
  const cyclic = [{ ...nodes[0], parentId: "cases" }, nodes[1]]; expect(categoryProducts("phones", cyclic)).toEqual([{ id: "one" }]); expect(categoryLabel(cyclic[0], cyclic)).toBe("Cases / Phones");
});
it("shows descendant products under a parent and keeps an empty category free of unrelated fallback products", () => {
  const product = (id: string) => ({ id, name: id === "one" ? "Actual phone case" : "Unrelated laptop", slug: id, price: 100, stock: 2, imageUrl: null });
  const categories = nodes.map((node) => ({ ...node, products: node.products.map((entry) => product(entry.id)) }));
  render(<ElectroCategoryShowcase categories={categories} allProducts={[product("one"), product("two")]} />);
  fireEvent.click(screen.getByRole("tab", { name: "Phones" })); expect(screen.getAllByText("Actual phone case").length).toBeGreaterThan(0); expect(screen.queryByText("Unrelated laptop")).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "Phones / Empty" })); expect(screen.queryByText("Actual phone case")).toBeNull(); expect(screen.queryByText("Unrelated laptop")).toBeNull(); expect(screen.getByText(/No products available in Empty/)).toBeTruthy();
});
function Departments() { const api = useCatalogDepartments(true); return <><ul>{api.rows.map((row) => <li key={row.id}><a href={`/categories/${encodeURIComponent(row.slug)}`}>{row.name}</a></li>)}</ul>{api.error && <p role="alert">{api.error}</p>}<button onClick={api.reload}>Reload departments</button></>; }
const response = (categories: unknown[], status = 200) => ({ ok: status === 200, json: async () => ({ success: status === 200, categories }) }) as Response;
it("loads actual root departments once in StrictMode and refreshes renamed/deleted navigation without seeded fallback", async () => {
  let rows = nodes;
  global.fetch = jest.fn().mockImplementation(async () => response(rows));
  render(<StrictMode><Departments /></StrictMode>); await screen.findByRole("link", { name: "Phones" }); expect(fetch).toHaveBeenCalledTimes(1); expect(screen.queryByRole("link", { name: "Cases" })).toBeNull();
  rows = [{ ...nodes[0], name: "Renamed department", slug: "renamed-department" }]; fireEvent.click(screen.getByRole("button", { name: "Reload departments" })); expect((await screen.findByRole("link", { name: "Renamed department" })).getAttribute("href")).toBe("/categories/renamed-department"); expect(screen.queryByRole("link", { name: "Laptops" })).toBeNull();
  (fetch as jest.Mock).mockResolvedValue(response([], 503)); fireEvent.click(screen.getByRole("button", { name: "Reload departments" })); await screen.findByRole("alert"); expect(screen.queryByRole("link", { name: "Renamed department" })).toBeNull();
});
it("aborts public navigation loading on unmount and ignores its late response", async () => {
  let finish!: (value: Response) => void; global.fetch = jest.fn().mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
  const rendered = render(<Departments />); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1)); const signal = (fetch as jest.Mock).mock.calls[0][1].signal;
  rendered.unmount(); expect(signal.aborted).toBe(true); await act(async () => finish(response(nodes)));
});
