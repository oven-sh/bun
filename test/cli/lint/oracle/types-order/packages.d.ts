// What the components below import from other packages, as stand-ins of their shapes.
import type { Snippet } from "./svelte";
import type { ClassValue } from "./html";

export interface IconProps {
  size?: number | string;
  color?: string;
  strokeWidth?: number | string;
  class?: ClassValue | null;
  absoluteStrokeWidth?: boolean;
}

export interface TableFeature {
  getDefaultOptions?: () => object;
}

export interface ColumnMeta {
  label?: string;
}

export type TableFeatures = {
  columnFilteringFeature: TableFeature;
  columnSizingFeature: TableFeature;
  columnVisibilityFeature: TableFeature;
  rowPaginationFeature: TableFeature;
  rowSelectionFeature: TableFeature;
  rowSortingFeature: TableFeature;
  columnMeta: ColumnMeta;
};

export interface Column<TFeatures, TData, TValue> {
  id: string;
  getCanSort(): boolean;
  getIsSorted(): false | "asc" | "desc";
  getToggleSortingHandler(): undefined | ((event: unknown) => void);
  getValue(row: TData): TValue;
  features: TFeatures;
}

export type LayoutData = { locale: string; user: { name: string } | null };

export type LayoutProps = {
  params: { lang?: string; path?: string };
  data: LayoutData;
  children: Snippet;
};
