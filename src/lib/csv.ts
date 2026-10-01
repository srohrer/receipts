import Papa from "papaparse";
import type { Cell, ColumnProfile, ColumnType, Dataset, DatasetSummary, Row } from "./types";

const NULLISH = new Set(["", "na", "n/a", "null", "none", "nan", "-"]);
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/;
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const YEAR_MONTH = /^(\d{4})-(\d{2})$/;

export function parseNumber(raw: string): number | null {
  const s = raw.trim().replace(/^[$€£¥]/, "").replace(/,/g, "").replace(/%$/, "");
  if (s === "" || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Normalizes recognizable dates to ISO strings (YYYY-MM-DD or YYYY-MM-DD HH:MM). */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = ISO_DATE.exec(s);
  if (m) {
    const [, y, mo, d, h, mi] = m;
    if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return null;
    return h ? `${y}-${mo}-${d} ${h}:${mi}` : `${y}-${mo}-${d}`;
  }
  m = YEAR_MONTH.exec(s);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${m[2]}-01`;
  m = US_DATE.exec(s);
  if (m) {
    const [, mo, d, y] = m;
    if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return null;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

function parseBoolean(raw: string): boolean | null {
  const s = raw.trim().toLowerCase();
  if (s === "true" || s === "yes") return true;
  if (s === "false" || s === "no") return false;
  return null;
}

const isNullish = (v: string) => NULLISH.has(v.trim().toLowerCase());

export function inferType(values: string[]): ColumnType {
  const present = values.filter((v) => !isNullish(v));
  if (present.length === 0) return "text";
  const share = (fn: (v: string) => unknown) =>
    present.filter((v) => fn(v) !== null).length / present.length;

  if (share(parseBoolean) >= 0.98) return "boolean";
  if (share(parseNumber) >= 0.95) return "number";
  if (share(parseDate) >= 0.95) return "date";
  const distinct = new Set(present).size;
  if (distinct <= 50 || distinct / present.length < 0.2) return "category";
  return "text";
}

function coerce(raw: string, type: ColumnType): Cell {
  if (isNullish(raw)) return null;
  switch (type) {
    case "number":
      return parseNumber(raw);
    case "date":
      return parseDate(raw);
    case "boolean":
      return parseBoolean(raw);
    default:
      return raw.trim();
  }
}

export function profileColumn(name: string, type: ColumnType, rows: Row[]): ColumnProfile {
  const values = rows.map((r) => r[name]);
  const present = values.filter((v): v is Exclude<Cell, null> => v !== null);
  const counts = new Map<string, number>();
  for (const v of present) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);

  const profile: ColumnProfile = {
    name,
    type,
    nullCount: values.length - present.length,
    distinctCount: counts.size,
  };

  if (type === "number") {
    const nums = present as number[];
    let min = Infinity, max = -Infinity, sum = 0;
    for (const n of nums) {
      if (n < min) min = n;
      if (n > max) max = n;
      sum += n;
    }
    const bins = new Array(12).fill(0);
    const span = max - min || 1;
    for (const n of nums) bins[Math.min(11, Math.floor(((n - min) / span) * 12))]++;
    profile.numeric = nums.length
      ? { min, max, sum, mean: sum / nums.length, histogram: bins }
      : { min: 0, max: 0, sum: 0, mean: 0, histogram: bins };
  } else if (type === "date") {
    const sorted = (present as string[]).slice().sort();
    if (sorted.length) profile.dateRange = { min: sorted[0], max: sorted[sorted.length - 1] };
  } else {
    profile.topValues = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([value, count]) => ({ value, count }));
  }
  return profile;
}

/** Turns raw parsed CSV records into a typed, profiled dataset. */
export function buildDataset(
  records: Record<string, string>[],
  meta: { id: string; name: string; source: Dataset["source"]; description?: string },
): Dataset {
  // Headers are trimmed here rather than via Papa's transformHeader: functions can't be
  // posted to the parsing Web Worker.
  const headers = Object.keys(records[0] ?? {})
    .map((raw) => ({ raw, name: raw.trim() }))
    .filter((h) => h.name !== "");
  const names = headers.map((h) => h.name);
  const types = Object.fromEntries(
    headers.map((h) => [h.name, inferType(records.slice(0, 2000).map((r) => r[h.raw] ?? ""))]),
  ) as Record<string, ColumnType>;

  const rows: Row[] = records.map((rec) => {
    const row: Row = {};
    for (const h of headers) row[h.name] = coerce(rec[h.raw] ?? "", types[h.name]);
    return row;
  });

  return { ...meta, rows, columns: names.map((n) => profileColumn(n, types[n], rows)) };
}

export function parseCsvText(
  text: string,
  meta: Parameters<typeof buildDataset>[1],
): Dataset {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
  });
  if (!result.data.length) throw new Error("The CSV has no data rows.");
  return buildDataset(result.data, meta);
}

export function parseCsvFile(file: File): Promise<Dataset> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      worker: true,
      complete: (result) => {
        if (!result.data.length) return reject(new Error("The CSV has no data rows."));
        const name = file.name.replace(/\.csv$/i, "");
        resolve(buildDataset(result.data, { id: `upload:${name}:${Date.now()}`, name, source: "upload" }));
      },
      error: (err) => reject(err),
    });
  });
}

/** What the model gets to see: schema, profile and a handful of rows. */
export function summarize(ds: Dataset, sampleSize = 12): DatasetSummary {
  const step = Math.max(1, Math.floor(ds.rows.length / sampleSize));
  const sampleRows: Row[] = [];
  for (let i = 0; i < ds.rows.length && sampleRows.length < sampleSize; i += step) {
    sampleRows.push(ds.rows[i]);
  }
  return {
    name: ds.name,
    rowCount: ds.rows.length,
    columns: ds.columns.map(({ numeric, ...rest }) =>
      numeric ? { ...rest, numeric: { ...numeric, histogram: [] } } : rest,
    ),
    sampleRows,
  };
}
