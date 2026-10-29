import { specificationsSchema } from "@/lib/validations/specifications";
import { comparisonHref, comparisonQuery } from "@/lib/validations/comparison";
import { useComparisonStore } from "@/stores/comparison-store";

it.each([null, {}, [{ label: "", value: "yes" }], [{ label: "a", value: "" }], [{ label: "a", value: "b", extra: true }], [{ label: "x".repeat(61), value: "b" }], [{ label: "a", value: "x".repeat(301) }], [{ label: "Screen", value: "yes" }, { label: " screen ", value: "no" }], [{ label: "a\u0000", value: "b" }], Array.from({ length: 31 }, (_, index) => ({ label: String(index), value: "b" }))])("rejects invalid specification sets: %p", (value) => {
  expect(specificationsSchema.safeParse(value).success).toBe(false);
});
it("normalizes plain spec labels/values without inventing missing details", () => {
  expect(specificationsSchema.parse([{ label: " Screen ", value: " OLED " }])).toEqual([{ label: "Screen", value: "OLED" }]);
  expect(specificationsSchema.parse([])).toEqual([]);
});
it("encodes ordered URL selections and rejects malformed, duplicate or oversized sets", () => {
  expect(comparisonHref(["one", "two"])).toBe("/compare?product=one&product=two");
  expect(comparisonQuery({ product: "one" }).success).toBe(true);
  for (const product of [["a", "a"], ["a", "b", "c", "d", "e"], [""], ["../private"], ["x".repeat(65)]]) expect(comparisonQuery({ product }).success).toBe(false);
});
it("keeps four distinct IDs, supports remove/clear, and rejects corrupt replacements", () => {
  const store = useComparisonStore.getState(); store.replace([]);
  for (const id of ["a", "b", "c", "d"]) expect(store.add(id)).toBe(true);
  expect(store.add("d")).toBe(true); expect(store.add("e")).toBe(false);
  store.remove("b"); expect(store.add("e")).toBe(true);
  expect(useComparisonStore.getState().ids).toEqual(["a", "c", "d", "e"]);
  store.replace(["a", "a"]); expect(useComparisonStore.getState().ids).toHaveLength(4);
  store.replace([]); expect(useComparisonStore.getState().ids).toEqual([]);
});
