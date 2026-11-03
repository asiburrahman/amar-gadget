/** Exact BDT display/input; aggregate paisa must never pass through a float. */
export function settlementMoney(value: string | bigint) {
  const text = String(value); if (!/^-?(0|[1-9][0-9]*)$/.test(text)) throw new Error("Settlement money could not be confirmed.");
  const amount = BigInt(text), absolute = amount < BigInt(0) ? -amount : amount;
  return `${amount < BigInt(0) ? "-" : ""}BDT ${(absolute / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${(absolute % BigInt(100)).toString().padStart(2, "0")}`;
}
export function parseSettlementAmount(value: string) {
  const match = /^(0|[1-9][0-9]{0,15})(?:\.([0-9]{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error("Enter a positive BDT amount with at most two decimal places.");
  const cents = BigInt(match[1]) * BigInt(100) + BigInt((match[2] ?? "").padEnd(2, "0"));
  if (cents < BigInt(1) || cents > BigInt("999999999999999999")) throw new Error("Payout amount is outside the supported positive range."); return cents.toString();
}
export function settlementPercent(bps: number) {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) throw new Error("Commercial terms could not be confirmed.");
  return `${Math.floor(bps / 100)}.${String(bps % 100).padStart(2, "0")}`;
}
