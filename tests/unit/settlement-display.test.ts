import { settlementMoney, parseSettlementAmount, settlementPercent } from "@/lib/settlement-display";
it("formats exact aggregate paisa and negative debt beyond floating-point precision", () => {
  expect(settlementMoney("9007199254740993")).toBe("BDT 90,071,992,547,409.93"); expect(settlementMoney("-9007199254740993")).toBe("-BDT 90,071,992,547,409.93"); expect(settlementMoney("0")).toBe("BDT 0.00"); expect(settlementMoney(BigInt(1))).toBe("BDT 0.01");
});
it("parses exact positive decimal payouts and rejects ambiguous or rounded inputs", () => {
  expect(parseSettlementAmount("90071992547409.93")).toBe("9007199254740993"); expect(parseSettlementAmount("0.01")).toBe("1"); expect(parseSettlementAmount("12.5")).toBe("1250");
  for (const input of ["", "0", "00.10", "1.001", "1e3", "-1", ".5", "10,000", "10000000000000000"]) expect(() => parseSettlementAmount(input)).toThrow();
});
it("does not silently display malformed money or terms as zero", () => {
  for (const value of ["01", "1.0", "NaN", "-0.5", "1e10"]) expect(() => settlementMoney(value)).toThrow(); expect(settlementPercent(1251)).toBe("12.51"); expect(settlementPercent(0)).toBe("0.00"); expect(settlementPercent(10000)).toBe("100.00"); expect(() => settlementPercent(10001)).toThrow();
});
