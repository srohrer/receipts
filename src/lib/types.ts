export type ColumnType = "number" | "date" | "category" | "text" | "boolean";

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;

export interface NumericProfile {
  min: number;
  max: number;
  mean: number;
  sum: number;
  /** 12-bin histogram counts, used for the schema sparkline */
  histogram: number[];
}

export interface ColumnProfile {
  name: string;
  type: ColumnType;
  nullCount: number;
  distinctCount: number;
  /** most frequent values (category/text/boolean) */
  topValues?: { value: string; count: number }[];
  numeric?: NumericProfile;
  dateRange?: { min: string; max: string };
}

export interface Dataset {
  id: string;
  name: string;
  source: "sample" | "upload";
  description?: string;
  rows: Row[];
  columns: ColumnProfile[];
}

/** The slice of a dataset that is sent to the model — never the full rows. */
export interface DatasetSummary {
  name: string;
  rowCount: number;
  columns: ColumnProfile[];
  sampleRows: Row[];
}
