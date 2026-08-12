import React from "react";

interface PriceProps {
  amount: number | string;
  currency?: string;
  className?: string;
  /**
   * Whether to show the currency symbol or code
   * @default "symbol"
   */
  currencyDisplay?: "symbol" | "code" | "name";
  /**
   * Number of decimal places to show
   * @default 2
   */
  precision?: number;
}

export const Price = ({
  amount,
  currency = "BDT",
  className = "",
  currencyDisplay = "symbol",
  precision = 2,
}: PriceProps) => {
  const numericAmount = typeof amount === "string" ? parseFloat(amount) : amount;

  // Format the amount with proper decimal places
  const formattedAmount = numericAmount.toFixed(precision);

  // Currency symbol mapping (simplified - in production you'd use Intl.NumberFormat)
  const currencySymbols: Record<string, string> = {
    BDT: "�৳",
    USD: "$",
    EUR: "€",
    GBP: "£",
    INR: "�₹",
  };

  const currencySymbol = currencySymbols[currency] || currency;

  return (
    <span className={`${className} text-xl font-bold text-foreground`}>
      {currencyDisplay === "symbol" ? currencySymbol : currencyDisplay === "code" ? currency : ""}
      {formattedAmount}
      {currencyDisplay === "name" && ` ${currency}`}
    </span>
  );
};