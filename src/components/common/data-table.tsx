import * as React from "react";
import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { TableSkeleton } from "@/components/common/loading-state";
import { cn } from "@/lib/utils";

export type DataTableColumn<T> = {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  align?: "left" | "right" | "center";
  /** Hide below the `md` breakpoint to keep phone tables readable. */
  hideOnMobile?: boolean;
  className?: string;
};

export type DataTablePagination = {
  /** 1-based. */
  page: number;
  pageCount: number;
  total: number;
  onPageChange: (page: number) => void;
};

type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  /** Accessible name for the table. Rendered visually hidden. */
  caption: string;
  loading?: boolean;
  /** User-facing message. Presence switches the table into its error state. */
  error?: string;
  onRetry?: () => void;
  empty?: { icon?: LucideIcon; title: string; description?: React.ReactNode; action?: React.ReactNode };
  pagination?: DataTablePagination;
  className?: string;
};

/**
 * Presentational, server-driven table. It never sorts, filters or slices data
 * itself: the caller passes the current page of rows and handles paging.
 * Covers the four states every list needs: loading, error, empty, data.
 */
function DataTable<T>({
  columns,
  rows,
  getRowId,
  caption,
  loading = false,
  error,
  onRetry,
  empty = { title: "Nothing here yet" },
  pagination,
  className,
}: DataTableProps<T>) {
  if (loading) {
    return <TableSkeleton columns={Math.min(columns.length, 5)} label={`Loading ${caption}`} />;
  }
  if (error) {
    return <ErrorState message={error} onRetry={onRetry} />;
  }
  if (rows.length === 0) {
    return <EmptyState {...empty} />;
  }

  return (
    <div className={className}>
      <Table>
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((column) => (
              <TableHead
                key={column.key}
                align={column.align}
                className={cn(column.hideOnMobile && "hidden md:table-cell")}
              >
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={getRowId(row)}>
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  align={column.align}
                  className={cn(
                    column.hideOnMobile && "hidden md:table-cell",
                    column.className,
                  )}
                >
                  {column.cell(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {pagination ? <Pagination {...pagination} /> : null}
    </div>
  );
}

function Pagination({ page, pageCount, total, onPageChange }: DataTablePagination) {
  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-3 border-t px-4 py-3"
    >
      <p className="text-xs text-muted-foreground" aria-live="polite">
        Page {page} of {Math.max(pageCount, 1)} · {total} total
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft aria-hidden />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          Next
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </nav>
  );
}

export { DataTable };
