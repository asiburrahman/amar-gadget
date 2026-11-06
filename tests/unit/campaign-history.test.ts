import { campaignFieldsSchema, campaignSaveSchema } from "@/lib/validations/campaign";
import { cleanHistory, HISTORY_RETENTION_MS } from "@/lib/validations/recent-history";
import { useRecentHistoryStore } from "@/stores/recent-history-store";
import { STORE_CURRENCY } from "@/lib/currency";
import { formatCurrency } from "@/lib/formatter";

const input = { title: "Current offers", slug: "current-offers", description: "Real products", startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-11-01T00:00:00Z", isActive: true, productIds: ["product-1"] };
it.each([{ title: " " }, { slug: "../bad" }, { startsAt: "invalid" }, { endsAt: input.startsAt }, { productIds: [] }, { productIds: ["a", "a"] }, { productIds: Array.from({ length: 51 }, (_, index) => `p-${index}`) }, { title: "x".repeat(121) }, { description: "x".repeat(1001) }, { isActive: "true" }, { price: 1 }])("rejects unsafe campaign fields: %p", (changes) => {
  expect(campaignFieldsSchema.safeParse({ ...input, ...changes }).success).toBe(false);
});
it("permits a disabled empty draft, requires versions for editing and retains UTC time", () => {
  expect(campaignFieldsSchema.parse({ ...input, isActive: false, productIds: [] }).startsAt).toBe(input.startsAt);
  expect(campaignSaveSchema.safeParse({ id: "one", fields: input }).success).toBe(false);
  expect(campaignSaveSchema.safeParse({ id: "one", version: 1, fields: input }).success).toBe(true);
});
it("discards corrupt, expired/future history and deduplicates by latest view", () => {
  const now = Date.now();
  expect(cleanHistory([{ id: "old", viewedAt: now - HISTORY_RETENTION_MS }, { id: "future", viewedAt: now + 1 }, { id: "a", viewedAt: now - 2 }, { id: "a", viewedAt: now - 1 }, { id: "b", viewedAt: now }], now)).toEqual([{ id: "b", viewedAt: now }, { id: "a", viewedAt: now - 1 }]);
  expect(cleanHistory({ entries: [] })).toEqual([]); expect(cleanHistory([{ id: "../private", viewedAt: now }])).toEqual([]);
});
it("records only bounded ID/timestamp history and moves repeat views to the front", () => {
  const store = useRecentHistoryStore.getState(); store.clear();
  for (let index = 0; index < 22; index++) store.record(`p-${index}`);
  expect(useRecentHistoryStore.getState().entries).toHaveLength(20);
  store.record("p-10"); expect(useRecentHistoryStore.getState().entries[0].id).toBe("p-10");
  expect(useRecentHistoryStore.getState().entries.filter((entry) => entry.id === "p-10")).toHaveLength(1);
  store.record("../bad"); expect(useRecentHistoryStore.getState().entries[0].id).toBe("p-10"); store.clear();
});
it("uses BDT with the actual taka symbol rather than relabeling another currency", () => { expect(STORE_CURRENCY).toBe("BDT"); expect(formatCurrency(123.45)).toBe("\u09F3123.45"); });
