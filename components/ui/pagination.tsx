import React from "react";
import { Button } from "./button";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
  /**
   * Number of siblings to show on each side of the current page.
   * @default 1
   */
  siblingCount?: number;
  /**
   * Number of boundaries to show at the start and end.
   * @default 1
   */
  boundaryCount?: number;
  /**
   * Label for the previous button.
   * @default "Previous"
   */
  previousLabel?: string;
  /**
   * Label for the next button.
   * @default "Next"
   */
  nextLabel?: string;
}

export const Pagination = ({
  currentPage,
  totalPages,
  onPageChange,
  className = "",
  siblingCount = 1,
  boundaryCount = 1,
  previousLabel = "Previous",
  nextLabel = "Next",
}: PaginationProps) => {
  const total = Number.isFinite(totalPages) ? Math.max(0, Math.trunc(totalPages)) : 0;
  if (total <= 1) return null;
  const activePage = Math.min(total, Math.max(1, Number.isFinite(currentPage) ? Math.trunc(currentPage) : 1));
  const boundaries = Number.isFinite(boundaryCount) ? Math.min(total, Math.max(0, Math.trunc(boundaryCount))) : 1;
  const siblings = Number.isFinite(siblingCount) ? Math.min(total, Math.max(0, Math.trunc(siblingCount))) : 1;
  const selected = new Set<number>();
  for (let index = 1; index <= boundaries; index++) { selected.add(index); selected.add(total - index + 1); }
  for (let index = Math.max(1, activePage - siblings); index <= Math.min(total, activePage + siblings); index++) selected.add(index);
  const pages: ({ type: "page"; value: number } | { type: "ellipsis" })[] = [];
  let previous: number | undefined;
  for (const value of [...selected].sort((left, right) => left - right)) {
    if (previous !== undefined && value - previous === 2) pages.push({ type: "page", value: previous + 1 });
    else if (previous !== undefined && value - previous > 2) pages.push({ type: "ellipsis" });
    pages.push({ type: "page", value }); previous = value;
  }

  return (
    <nav
      aria-label="Pagination"
      className={`flex flex-col sm:flex-row sm:items-center sm:space-x-2 justify-center
        ${className}
      `}
    >
      {/* Previous button */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(Math.max(activePage - 1, 1))}
        disabled={activePage === 1}
      >
        {previousLabel}
      </Button>

      {/* Page numbers */}
      <div className="flex space-x-1">
        {pages.map((page, index) => {
          if (page.type === "page") {
            const isCurrent = page.value === activePage;
            return (
              <Button
                key={index}
                variant={isCurrent ? "default" : "outline"}
                size="sm"
                onClick={() => onPageChange(page.value)}
                aria-current={isCurrent ? "page" : undefined}
                disabled={isCurrent}
              >
                {page.value}
              </Button>
            );
          }

          // Ellipsis
          return (
            <span
              key={index}
              className="flex h-11 w-11 items-center justify-center rounded-lg
                text-muted-foreground
              "
            >
              …
            </span>
          );
        })}
      </div>

      {/* Next button */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(Math.min(activePage + 1, total))}
        disabled={activePage === total}
      >
        {nextLabel}
      </Button>
    </nav>
  );
};
