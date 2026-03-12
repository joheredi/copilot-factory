/**
 * Pagination controls for the task board.
 *
 * Renders page navigation with previous/next buttons, page numbers,
 * current position indicator, and a page-size selector. Designed to
 * work with the server-side pagination from the task list API.
 *
 * @see T094 — Build task board with status filtering and pagination
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../../../components/ui/button.js";

/** Available page size options. */
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

export interface PaginationControlsProps {
  /** Current page (1-based). */
  readonly page: number;
  /** Items per page. */
  readonly limit: number;
  /** Total number of items matching the current filters. */
  readonly total: number;
  /** Callback when page changes. */
  readonly onPageChange: (page: number) => void;
  /** Callback when page size changes. */
  readonly onLimitChange: (limit: number) => void;
}

/**
 * Renders pagination controls with page navigation and size selector.
 *
 * Shows the current range of items (e.g. "1-20 of 156"), page buttons,
 * and a page-size selector. The component hides when there are no items
 * to paginate.
 */
export function PaginationControls({
  page,
  limit,
  total,
  onPageChange,
  onLimitChange,
}: PaginationControlsProps) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const startItem = total === 0 ? 0 : (page - 1) * limit + 1;
  const endItem = Math.min(page * limit, total);

  if (total === 0) return null;

  /**
   * Builds a compact array of page numbers to show, with ellipsis gaps.
   * Always shows first, last, and pages around the current page.
   */
  function getPageNumbers(): (number | "ellipsis")[] {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    const pages: (number | "ellipsis")[] = [1];

    if (page > 3) {
      pages.push("ellipsis");
    }

    const rangeStart = Math.max(2, page - 1);
    const rangeEnd = Math.min(totalPages - 1, page + 1);

    for (let i = rangeStart; i <= rangeEnd; i++) {
      pages.push(i);
    }

    if (page < totalPages - 2) {
      pages.push("ellipsis");
    }

    if (totalPages > 1) {
      pages.push(totalPages);
    }

    return pages;
  }

  return (
    <div
      className="flex flex-col items-center justify-between gap-4 sm:flex-row"
      data-testid="pagination-controls"
    >
      {/* Items range display */}
      <div className="text-sm text-muted-foreground" data-testid="pagination-info">
        Showing {startItem}–{endItem} of {total} tasks
      </div>

      {/* Page navigation */}
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          data-testid="pagination-prev"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        {getPageNumbers().map((pageNum, idx) =>
          pageNum === "ellipsis" ? (
            <span key={`ellipsis-${idx}`} className="px-2 text-sm text-muted-foreground">
              …
            </span>
          ) : (
            <Button
              key={pageNum}
              variant={pageNum === page ? "default" : "outline"}
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => onPageChange(pageNum)}
              data-testid={`pagination-page-${pageNum}`}
              aria-current={pageNum === page ? "page" : undefined}
            >
              {pageNum}
            </Button>
          ),
        )}

        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          data-testid="pagination-next"
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Page size selector */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Per page:</span>
        <div className="flex gap-1">
          {PAGE_SIZE_OPTIONS.map((size) => (
            <Button
              key={size}
              variant={limit === size ? "default" : "outline"}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onLimitChange(size)}
              data-testid={`page-size-${size}`}
            >
              {size}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
