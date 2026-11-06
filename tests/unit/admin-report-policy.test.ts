import { resolveReportPeriod } from "@/lib/validations/admin-reports";
it("defaults to the current 30 Dhaka calendar days across a UTC year boundary", () => {
  expect(resolveReportPeriod({}, new Date("2026-12-31T18:00:00Z"))).toMatchObject({ from: "2026-12-03", to: "2027-01-01", page: 1, format: "json" });
});
it("accepts leap-day dates and rejects reversed, missing, fractional and excessive range/filter inputs", () => {
  expect(resolveReportPeriod({ from: "2024-02-29", to: "2024-02-29" })).toMatchObject({ from: "2024-02-29" });
  for (const value of [{ from: "2026-02-29", to: "2026-03-01" }, { from: "2026-11-02" }, { from: "2026-11-03", to: "2026-11-02" }, { from: "2025-01-01", to: "2026-01-02" }, { page: "1.5" }, { format: "xlsx" }, { customerId: "anything" }]) expect(() => resolveReportPeriod(value)).toThrow();
});
