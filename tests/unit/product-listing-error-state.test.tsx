/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
jest.mock("@/lib/catalog-listing", () => ({ getCatalogListing: jest.fn(), CatalogQueryError: class extends Error { constructor(message: string, readonly code = "INVALID_QUERY") { super(message); } } }));
jest.mock("@/lib/catalog-options", () => ({ getCatalogOptions: jest.fn() }));
jest.mock("@/components/catalog/catalog-filters", () => ({ CatalogFilters: () => <p>Healthy filter choices</p> }));
jest.mock("@/components/shared/product-grid", () => ({ ProductGrid: () => <p>Healthy product grid</p> }));
import ProductsPage from "@/app/(marketing)/products/page";
import { getCatalogListing, CatalogQueryError } from "@/lib/catalog-listing";
import { getCatalogOptions } from "@/lib/catalog-options";
import { catalogQuerySchema } from "@/lib/validations/catalog-query";
beforeEach(() => { jest.clearAllMocks(); (getCatalogOptions as jest.Mock).mockResolvedValue({ items: [], page: 1, limit: 25, total: 0, totalPages: 0 }); });
it("provides a correlated retry preserving valid filters instead of a healthy empty product result", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    (getCatalogListing as jest.Mock).mockRejectedValue(Object.assign(Error("private SQL token"), { code: "P1001" }));
    render(await ProductsPage({ searchParams: Promise.resolve({ categoryId: "category-id", page: "2" }) }));
    const reference = JSON.parse(log.mock.calls[0][0]).reference; expect(screen.getByText(`Reference: ${reference}`)).toBeTruthy(); expect(screen.getByRole("link", { name: "Retry product results" }).getAttribute("href")).toBe("/products?categoryId=category-id&page=2");
    expect(screen.queryByText(/Showing 0 of 0/)).toBeNull(); expect(screen.queryByText("Healthy product grid")).toBeNull(); expect(screen.queryByText(/private SQL/)).toBeNull();
  } finally { log.mockRestore(); }
});
it("reports a separate filter-choice failure while retaining a genuinely healthy empty product result", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    (getCatalogListing as jest.Mock).mockResolvedValue({ products: [], query: catalogQuerySchema.parse({}), brandFilter: { state: "none" }, categoryFilter: { state: "none" }, total: 0, totalPages: 0, page: 1, limit: 12, outOfRange: false });
    (getCatalogOptions as jest.Mock).mockRejectedValue(Object.assign(Error("private option SQL"), { code: "P2021" }));
    render(await ProductsPage({})); expect(screen.getByText("Showing 0 of 0 products")).toBeTruthy(); expect(screen.getByText("Healthy product grid")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Retry filters" })).toBeTruthy(); expect(screen.getByRole("alert").textContent).toContain(JSON.parse(log.mock.calls[0][0]).reference); expect(log).toHaveBeenCalledTimes(1);
  } finally { log.mockRestore(); }
});
it("retains expected invalid-query recovery without logging it as an infrastructure failure", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try { (getCatalogListing as jest.Mock).mockRejectedValue(new CatalogQueryError("Check the page number")); render(await ProductsPage({ searchParams: Promise.resolve({ page: "0" }) })); expect(screen.getByText("Invalid product filters")).toBeTruthy(); expect(screen.getByRole("link", { name: "Reset filters" })).toBeTruthy(); expect(log).not.toHaveBeenCalled(); }
  finally { log.mockRestore(); }
});
