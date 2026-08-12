export interface PaginationParams {
  page?: number;
  limit?: number;
  totalItems: number;
}

export interface PaginationResult {
  page: number;
  limit: number;
  skip: number;
  take: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

/**
 * Calculates pagination offsets, page counts, and navigation flags.
 */
export function getPaginationParams({
  page = 1,
  limit = 10,
  totalItems,
}: PaginationParams): PaginationResult {
  const currentPage = Math.max(1, page);
  const pageSize = Math.max(1, limit);
  const totalPages = Math.ceil(totalItems / pageSize);
  const skip = (currentPage - 1) * pageSize;

  return {
    page: currentPage,
    limit: pageSize,
    skip,
    take: pageSize,
    totalPages,
    hasNextPage: currentPage < totalPages,
    hasPrevPage: currentPage > 1,
  };
}