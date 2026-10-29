/** @jest-environment jsdom */
import { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CampaignCard } from "@/components/catalog/campaign-card";
import { CampaignEditor } from "@/components/catalog/campaign-editor";
import { RecordProductView } from "@/components/catalog/record-product-view";
import { RecentlyViewed } from "@/components/home/recently-viewed";
import { SpecialDealSection } from "@/components/home/special-deal-section";
import { useRecentHistoryStore } from "@/stores/recent-history-store";
import { saveCampaign } from "@/server/actions/admin/campaign-actions";
import type { ActiveCampaign } from "@/lib/campaigns";
import { Price } from "@/components/shared/price";
import { BrandLogos } from "@/components/home/brand-logos";
import { ProductCard } from "@/components/shared/product-card";
const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
jest.mock("@/server/actions/admin/campaign-actions", () => ({ saveCampaign: jest.fn(), deleteCampaign: jest.fn() }));
const product = { id: "one", slug: "one", name: "Real phone", price: 100, discountPrice: 90, stock: 2, rating: 0, category: "Phones", imageUrl: null };
beforeEach(() => { useRecentHistoryStore.getState().clear(); jest.clearAllMocks(); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

it("counts down from SQL time despite a wrong browser clock and removes product offers at expiry", () => {
  jest.useFakeTimers({ now: new Date("2020-01-01T00:00:00Z") });
  const now = "2026-10-29T00:00:00.000Z";
  const campaign: ActiveCampaign = { id: "campaign", title: "Live campaign", slug: "live", description: "Current catalog offers", startsAt: now, endsAt: "2026-10-29T00:00:02.000Z", products: [product] };
  const view = render(<CampaignCard campaign={campaign} serverNow={now} />);
  expect(screen.getByRole("timer").textContent).toContain("2s");
  act(() => jest.advanceTimersByTime(3000)); expect(screen.getByRole("status").textContent).toContain("has ended");
  expect(screen.queryByRole("button", { name: "Add to Cart" })).toBeNull(); view.unmount(); expect(jest.getTimerCount()).toBe(0);
});
it("records only mounted product views and loads fresh products from that browser history", async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, products: [{ ...product, imageUrl: undefined, discountPrice: 80 }] }) });
  render(<><RecordProductView productId="one" /><RecentlyViewed /></>);
  expect(await screen.findByRole("heading", { name: "Real phone" })).toBeTruthy();
  expect(useRecentHistoryStore.getState().entries.map((entry) => entry.id)).toEqual(["one"]);
  const url = (fetch as jest.Mock).mock.calls[0][0]; expect(url).toContain("product=one");
  expect(screen.getByText("৳80.00")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear viewing history" }));
  await waitFor(() => expect(screen.queryByRole("heading", { name: "Real phone" })).toBeNull()); expect(useRecentHistoryStore.getState().entries).toEqual([]);
});
it("does not replace empty or failed history with recent catalog products and supports retry", async () => {
  useRecentHistoryStore.getState().record("one");
  global.fetch = jest.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, products: [] }) });
  render(<RecentlyViewed />); expect(await screen.findByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry recent products" })); await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("No available products"));
});
it("cancels stale history requests on selection changes/unmount", async () => {
  global.fetch = jest.fn(() => new Promise(() => {})); useRecentHistoryStore.getState().record("one");
  const view = render(<RecentlyViewed />); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const first = (fetch as jest.Mock).mock.calls[0][1].signal;
  act(() => useRecentHistoryStore.getState().record("two")); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2)); expect(first.aborted).toBe(true);
  const second = (fetch as jest.Mock).mock.calls[1][1].signal; view.unmount(); expect(second.aborted).toBe(true);
});
it("keeps on-sale and top-rated collections empty rather than substituting featured products", () => {
  render(<SpecialDealSection featuredProducts={[{ ...product, imageUrl: undefined }]} />);
  fireEvent.click(screen.getByRole("button", { name: "On sale" })); expect(screen.queryByRole("heading", { name: "Real phone" })).toBeNull(); expect(screen.getByText("No on sale products currently available.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Top rated" })); expect(screen.getByText("No top rated products currently available.")).toBeTruthy();
});
it("edits real campaign fields/products, retains failed edits and submits UTC dates", async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, totalPages: 1, products: [product] }) });
  (saveCampaign as jest.Mock).mockResolvedValue({ success: false, error: "Campaign changed. Reload before saving." });
  render(<CampaignEditor />);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Actual campaign" } }); fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "actual-campaign" } });
  fireEvent.change(screen.getByLabelText("Start (UTC)"), { target: { value: "2026-10-29T10:00:00" } }); fireEvent.change(screen.getByLabelText("End (UTC)"), { target: { value: "2026-10-30T10:00:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Find products" })); fireEvent.click(await screen.findByRole("button", { name: "Add Real phone" }));
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.submit(screen.getByRole("form")); expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Campaign changed. Reload before saving.");
  const submitted = (saveCampaign as jest.Mock).mock.calls[0][0]; expect(submitted.fields.startsAt).toBe("2026-10-29T10:00:00Z"); expect(submitted.fields.productIds).toEqual(["one"]); expect(screen.getByLabelText("Title")).toHaveProperty("value", "Actual campaign"); expect(refresh).not.toHaveBeenCalled();
});
it("renders actual brand counts and the fixed BDT price component", () => {
  render(<><BrandLogos brands={[{ id: "brand", slug: "brand", name: "Actual brand", count: 3 }]} /><Price amount={90} currencyDisplay="code" /></>);
  expect(screen.getByRole("link", { name: "Actual brand" }).getAttribute("href")).toBe("/products?brandId=brand"); expect(screen.getByText("3 public products")).toBeTruthy(); expect(screen.getByText(/BDT/)).toBeTruthy();
});
it("distinguishes failed product choices from a genuinely empty catalog search", async () => {
  global.fetch = jest.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, products: [], totalPages: 0 }) });
  render(<CampaignEditor />); fireEvent.click(screen.getByRole("button", { name: "Find products" }));
  expect(await screen.findByRole("alert")).toBeTruthy(); expect(screen.queryByText("No products match this search.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry product choices" })); expect(await screen.findByText("No products match this search.")).toBeTruthy(); expect(screen.queryByRole("alert")).toBeNull();
});
it("uses the same nullish effective-price rule as checkout for legacy zero-valued discounts", () => {
  render(<ProductCard {...product} imageUrl={undefined} discountPrice={0} />);
  expect(screen.getByText("৳0.00")).toBeTruthy(); expect(screen.queryByText("৳100.00")).toBeNull();
});
