import { STORE_CURRENCY } from "@/lib/currency";
type PriceProps = { amount: number | string; currency?: typeof STORE_CURRENCY; className?: string; currencyDisplay?: "symbol" | "code" | "name"; precision?: number };
export function Price({ amount, currency = STORE_CURRENCY, className = "", currencyDisplay = "symbol", precision = 2 }: PriceProps) {
  if (currency !== STORE_CURRENCY) throw new Error("This store prices and charges orders in BDT.");
  const value = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(value) || !Number.isInteger(precision) || precision < 0 || precision > 2) throw new Error("Invalid price display.");
  return <span className={`${className} text-xl font-bold text-foreground`}>{new Intl.NumberFormat("en-BD", { style: "currency", currency: STORE_CURRENCY, currencyDisplay, minimumFractionDigits: precision, maximumFractionDigits: precision }).format(value)}</span>;
}
