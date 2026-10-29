/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CatalogFilters } from "@/components/catalog/catalog-filters";
import { catalogQuerySchema } from "@/lib/validations/catalog-query";
import type { CatalogOptions } from "@/lib/catalog-options";

jest.mock("next/form", () => ({ __esModule: true, default: (props: React.FormHTMLAttributes<HTMLFormElement>) => <form {...props} /> }));
const initial: CatalogOptions = { items: [{ id: "one", name: "First", slug: "first" }], page: 1, limit: 25, total: 26, totalPages: 2 };
const setup = () => render(<CatalogFilters query={catalogQuerySchema.parse({ page: 4, minPrice: 10 })} brands={initial} categories={initial} brand={initial.items[0]} />);
afterEach(() => jest.restoreAllMocks());

it("submits named filters without the old page and blocks inverted price ranges", () => {
  setup(); const form = screen.getByRole("form", { name: "Product filters" });
  const data = new FormData(form as HTMLFormElement);
  expect(data.get("brandId")).toBe("one"); expect(data.has("page")).toBe(false);
  expect(catalogQuerySchema.parse(Object.fromEntries(data)).page).toBe(1);
  fireEvent.change(screen.getByLabelText("Maximum price (BDT)"), { target: { value: "5" } });
  expect(fireEvent.submit(form)).toBe(false);
  expect(screen.getByRole("alert").textContent).toContain("Maximum price");
});

it("preserves selection across option pages and retries the actual failed search", async () => {
  const fetchMock = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, ...initial, page: 2, items: [{ id: "two", name: "Second", slug: "second" }] }) })
    .mockRejectedValueOnce(new Error("Temporarily unavailable"))
    .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, ...initial, page: 1, items: [], total: 0, totalPages: 0 }) });
  global.fetch = fetchMock;
  setup(); fireEvent.click(screen.getByRole("button", { name: "Next brand options" }));
  await waitFor(() => expect(within(screen.getByLabelText("Brand")).getByText("Second")).toBeTruthy());
  expect((screen.getByLabelText("Brand") as HTMLSelectElement).value).toBe("one");
  const search = screen.getByLabelText("Search brands");
  fireEvent.change(search, { target: { value: "Target" } });
  expect(fireEvent.keyDown(search, { key: "Enter" })).toBe(false);
  fireEvent.click(await screen.findByRole("button", { name: "Retry brand options" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  const requested = new URL(fetchMock.mock.calls[2][0], "http://localhost");
  expect(requested.searchParams.get("search")).toBe("Target"); expect(requested.searchParams.get("page")).toBe("1");
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect((screen.getByLabelText("Brand") as HTMLSelectElement).value).toBe("one");
});

it("aborts in-flight option requests on unmount", async () => {
  const fetchMock = jest.fn(() => new Promise(() => {})); global.fetch = fetchMock as typeof fetch;
  const view = setup(); fireEvent.click(screen.getByRole("button", { name: "Next brand options" }));
  const signal = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0][1].signal!;
  expect(signal.aborted).toBe(false); view.unmount(); expect(signal.aborted).toBe(true);
});
