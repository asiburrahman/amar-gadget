import React from "react";
import { Muted } from "@/components/ui/typography";

interface StatProps {
  title: string;
  value: string;
  change: string;
  isPositive: boolean;
  icon?: React.ReactNode;
  description?: string;
}

export function StatNumericCard({
  title,
  value,
  change,
  isPositive,
  icon,
  description,
}: StatProps) {
  return (
    <div className="rounded-xl border bg-card p-6 text-card-foreground shadow-sm transition-all hover:shadow-md">
      <div className="flex items-center justify-between gap-4">
        <Muted className="text-xs font-medium uppercase tracking-wider">{title}</Muted>
        {icon && <div className="text-muted-foreground select-none">{icon}</div>}
      </div>
      
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-bold tracking-tight font-mono leading-none">
          {value}
        </span>
        <span
          className={`inline-flex items-center text-xs font-semibold font-sans px-1.5 py-0.5 rounded-full ${
            isPositive
              ? "bg-green-500/10 text-green-600 dark:text-green-400"
              : "bg-red-500/10 text-red-600 dark:text-red-400"
          }`}
        >
          <span className="sr-only">
            {isPositive ? "Increased by" : "Decreased by"}
          </span>
          {isPositive ? "↑" : "↓"} {change}
        </span>
      </div>

      {description && (
        <p className="mt-2 text-xs text-muted-foreground font-sans">
          {description}
        </p>
      )}
    </div>
  );
}
