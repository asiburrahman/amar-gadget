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
  if (totalPages <= 1) return null;

  const range = (start: number, end: number) => {
    const length = end - start + 1;
    return Array.from({ length }, (_, i) => start + i);
  };

  const siblingLeft = Math.max(
    Math.min(currentPage - siblingCount, totalPages - boundaryCount * 2 - siblingCount * 2),
    boundaryCount + 2
  );

  const siblingRight = Math.min(
    Math.max(currentPage + siblingCount, boundaryCount * 2 + siblingCount * 2 + 2),
    totalPages - boundaryCount - 1
  );

  const showLeftEllipsis = siblingLeft > boundaryCount + 2;
  const showRightEllipsis = siblingRight < totalPages - boundaryCount - 1;

  const pages = [];

  // First boundary
  for (let i = 1; i <= boundaryCount; i++) {
    pages.push({
      type: "page",
      value: i,
    });
  }

  // Left ellipsis
  if (showLeftEllipsis) {
    pages.push({
      type: "ellipsis",
    });
  }

  // Siblings
  for (let i = siblingLeft; i <= siblingRight; i++) {
    pages.push({
      type: "page",
      value: i,
    });
  }

  // Right ellipsis
  if (showRightEllipsis) {
    pages.push({
      type: "ellipsis",
    });
  }

  // Second boundary
  for (
    let i = totalPages - boundaryCount + 1;
    i <= totalPages;
    i++
  ) {
    pages.push({
      type: "page",
      value: i,
    });
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
        onClick={() => onPageChange(Math.max(currentPage - 1, 1))}
        disabled={currentPage === 1}
      >
        {previousLabel}
      </Button>

      {/* Page numbers */}
      <div className="flex space-x-1">
        {pages.map((page, index) => {
          if (page.type === "page") {
            const isCurrent = page.value === currentPage;
            return (
              <Button
                key={index}
                variant={isCurrent ? "default" : "outline"}
                size="sm"
                onClick={() => onPageChange(page.value as number)}
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
        onClick={() => onPageChange(Math.min(currentPage + 1, totalPages))}
        disabled={currentPage === totalPages}
      >
        {nextLabel}
      </Button>
    </nav>
  );
};