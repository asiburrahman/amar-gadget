import { Prisma } from "@prisma/client";

/**
 * Formats a monetary amount into a currency string.
 * Defaults to Bangladeshi Taka (৳).
 */
export function formatCurrency(
  amount: number | Prisma.Decimal | string | null | undefined,
  currencySymbol = "৳"
): string {
  if (amount === null || amount === undefined) return `${currencySymbol}0.00`;

  const numericValue =
    typeof amount === "number"
      ? amount
      : typeof amount === "string"
      ? parseFloat(amount)
      : amount.toNumber();

  if (isNaN(numericValue)) return `${currencySymbol}0.00`;

  return `${currencySymbol}${numericValue.toLocaleString("en-BD", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Formats a date into a human-readable string.
 */
export function formatDate(date: Date | string | number): string {
  const dateObj = new Date(date);
  if (isNaN(dateObj.getTime())) return "";

  return dateObj.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Formats a number with locale thousands separators.
 */
export function formatNumber(num: number): string {
  if (typeof num !== "number" || isNaN(num)) return "0";
  return num.toLocaleString("en-US");
}