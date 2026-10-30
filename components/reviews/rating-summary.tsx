export function RatingSummary({ rating, count }: { rating: number; count?: number }) {
  if (!Number.isFinite(rating) || rating <= 0 || rating > 5 || count === 0) return <span className="text-muted-foreground">No reviews yet</span>;
  const label = `${rating.toFixed(1)} out of 5${count === undefined ? "" : ` from ${count} review${count === 1 ? "" : "s"}`}`;
  return <span aria-label={label} className="inline-flex flex-wrap items-center gap-1"><span aria-hidden="true" className="text-amber-500">{"★".repeat(Math.round(rating))}{"☆".repeat(5 - Math.round(rating))}</span><span>{rating.toFixed(1)}/5{count === undefined ? "" : ` (${count} ${count === 1 ? "review" : "reviews"})`}</span></span>;
}
