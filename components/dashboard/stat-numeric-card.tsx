import { Muted } from "@/components/ui/typography";

interface StatProps {
  title: string;
  value: string;
  change: string;
  isPositive: boolean;
}

export function StatNumericCard({ title, value, change, isPositive }: StatProps) {
  return (
    <div className="rounded-xl border bg-card p-6 text-card-foreground shadow-sm">
      <Muted className="text-xs font-medium uppercase tracking-wider">{title}</Muted>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-bold tracking-tight font-mono leading-none">
          {value}
        </span>
        <span
          className={`text-xs font-semibold font-sans ${
            isPositive ? "text-green-600" : "text-red-600"
          }`}
        >
          {isPositive ? "+" : ""}
          {change}
        </span>
      </div>
    </div>
  );
}
