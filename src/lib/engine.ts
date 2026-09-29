/**
 * Deterministic executor for the query DSL. Everything the user sees as a number
 * comes from here — never from the model.
 */
import type { Aggregate, Computed, Filter, GroupBy, Query } from "./dsl";
import type { Cell, ColumnProfile, ColumnType, Dataset, Row } from "./types";

export interface ResultColumn {
  name: string;
  type: ColumnType;
  role: "dimension" | "measure";
}

export interface QueryResult {
  id: string;
  title: string;
  columns: ResultColumn[];
  rows: Row[];
  /** rows that survived the WHERE clause, before grouping */
  matchedRows: number;
  sql: string;
}

export class QueryError extends Error {
  constructor(
    public queryId: string,
    message: string,
  ) {
    super(`Query "${queryId}": ${message}`);
  }
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY_INDEX = new Map(WEEKDAYS.map((d, i) => [d, i]));

export function compareCells(a: Cell, b: Cell): number {
  if (a === b) return 0;
  if (a === null) return 1; // nulls last
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const wa = WEEKDAY_INDEX.get(String(a));
  const wb = WEEKDAY_INDEX.get(String(b));
  if (wa !== undefined && wb !== undefined) return wa - wb;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

export function looseEquals(a: Cell, b: Cell | undefined): boolean {
  if (a === null || b === null || b === undefined) return a === b;
  if (typeof a === "number" || typeof b === "number") {
    const na = Number(a), nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return Math.abs(na - nb) <= 1e-9 * Math.max(1, Math.abs(na));
  }
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function bucketDate(iso: string, bucket: string): string {
  const y = iso.slice(0, 4);
  const m = Number(iso.slice(5, 7));
  switch (bucket) {
    case "year":
      return y;
    case "quarter":
      return `${y}-Q${Math.ceil(m / 3)}`;
    case "month":
      return iso.slice(0, 7);
    case "day":
      return iso.slice(0, 10);
    case "hour":
      return iso.length > 10 ? iso.slice(11, 13) : "00";
    case "week":
    case "weekday":
    case "daytype": {
      const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
      if (bucket === "week") return isoWeek(d);
      const dow = (d.getUTCDay() + 6) % 7;
      return bucket === "weekday" ? WEEKDAYS[dow] : dow >= 5 ? "Weekend" : "Weekday";
    }
    default:
      return iso;
  }
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = nums.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function makeResolver(queryId: string, columns: { name: string }[]) {
  const byLower = new Map(columns.map((c) => [c.name.toLowerCase(), c.name]));
  return (name: string, where: string): string => {
    const hit = byLower.get(name.toLowerCase());
    if (!hit) {
      throw new QueryError(
        queryId,
        `unknown column "${name}" in ${where}. Available columns: ${columns.map((c) => c.name).join(", ")}.`,
      );
    }
    return hit;
  };
}

function matchesFilter(value: Cell, f: Filter): boolean {
  const v = f.value;
  const asList = Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
  switch (f.op) {
    case "is_null":
      return value === null;
    case "not_null":
      return value !== null;
    case "eq":
      return looseEquals(value, asList[0]);
    case "neq":
      return !looseEquals(value, asList[0]);
    case "in":
      return asList.some((x) => looseEquals(value, x));
    case "not_in":
      return !asList.some((x) => looseEquals(value, x));
    case "contains":
      return value !== null && String(value).toLowerCase().includes(String(asList[0] ?? "").toLowerCase());
    case "between": {
      if (value === null || asList.length < 2) return false;
      return compareCells(value, coerceLike(value, asList[0])) >= 0 && compareCells(value, coerceLike(value, asList[1])) <= 0;
    }
    default: {
      if (value === null || asList[0] === undefined) return false;
      const c = compareCells(value, coerceLike(value, asList[0]));
      return f.op === "gt" ? c > 0 : f.op === "gte" ? c >= 0 : f.op === "lt" ? c < 0 : c <= 0;
    }
  }
}

function coerceLike(sample: Cell, v: string | number | boolean): Cell {
  if (typeof sample === "number") {
    const n = Number(v);
    return Number.isFinite(n) ? n : String(v);
  }
  return typeof v === "boolean" ? v : String(v);
}

interface GroupKey {
  source: string;
  bucket?: string;
  as: string;
}

function normalizeGroup(g: GroupBy, resolve: (n: string, w: string) => string, cols: Map<string, ColumnProfile>, qid: string): GroupKey {
  if (typeof g === "string") {
    const source = resolve(g, "groupBy");
    return { source, as: source };
  }
  const source = resolve(g.column, "groupBy");
  if (cols.get(source)?.type !== "date") {
    throw new QueryError(qid, `cannot bucket "${source}" by ${g.bucket}: it is not a date column.`);
  }
  return { source, bucket: g.bucket, as: g.as ?? `${source}_${g.bucket}` };
}

function aggregate(rows: Row[], agg: Aggregate, column: string | null): Cell {
  if (agg.fn === "count") {
    return column ? rows.reduce((n, r) => n + (r[column] !== null ? 1 : 0), 0) : rows.length;
  }
  if (!column) return null;
  if (agg.fn === "count_distinct") return new Set(rows.map((r) => r[column]).filter((v) => v !== null)).size;
  const nums = rows.map((r) => r[column]).filter((v): v is number => typeof v === "number");
  if (agg.fn === "median") return median(nums);
  if (!nums.length) return null;
  switch (agg.fn) {
    case "sum":
      return nums.reduce((a, b) => a + b, 0);
    case "avg":
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case "min":
      return nums.reduce((a, b) => (b < a ? b : a));
    case "max":
      return nums.reduce((a, b) => (b > a ? b : a));
  }
  return null;
}

function applyComputed(rows: Row[], c: Computed, resolve: (n: string, w: string) => string) {
  const operand = (x: string | number | null | undefined, row: Row): number | null => {
    if (x === null || x === undefined) return null;
    if (typeof x === "number") return x;
    const v = row[resolve(x, `computed "${c.as}"`)];
    return typeof v === "number" ? v : null;
  };
  if (c.op === "pct_of_total") {
    const total = rows.reduce((s, r) => s + (operand(c.left, r) ?? 0), 0);
    for (const r of rows) {
      const v = operand(c.left, r);
      r[c.as] = v === null || total === 0 ? null : (v / total) * 100;
    }
    return;
  }
  if (c.op === "pct_change_prev") {
    let prev: number | null = null;
    for (const r of rows) {
      const v = operand(c.left, r);
      r[c.as] = v === null || prev === null || prev === 0 ? null : ((v - prev) / Math.abs(prev)) * 100;
      prev = v;
    }
    return;
  }
  for (const r of rows) {
    const a = operand(c.left, r), b = operand(c.right, r);
    if (a === null || b === null) {
      r[c.as] = null;
      continue;
    }
    r[c.as] = c.op === "add" ? a + b : c.op === "sub" ? a - b : c.op === "mul" ? a * b : b === 0 ? null : a / b;
  }
}

export function executeQuery(ds: Dataset, q: Query): QueryResult {
  const cols = new Map(ds.columns.map((c) => [c.name, c]));
  const resolve = makeResolver(q.id, ds.columns);

  // WHERE
  const filters = (q.filters ?? []).map((f) => {
    const column = resolve(f.column, "filters");
    if (f.bucket && cols.get(column)?.type !== "date") {
      throw new QueryError(q.id, `cannot filter "${column}" by ${f.bucket}: it is not a date column.`);
    }
    return { ...f, column };
  });
  const cellFor = (r: Row, f: Filter): Cell => {
    const v = r[f.column];
    return f.bucket && typeof v === "string" ? bucketDate(v, f.bucket) : v;
  };
  const matched = filters.length ? ds.rows.filter((r) => filters.every((f) => matchesFilter(cellFor(r, f), f))) : ds.rows;

  const groups = (q.groupBy ?? []).map((g) => normalizeGroup(g, resolve, cols, q.id));
  let aggs = q.aggregates ?? [];
  if (groups.length && !aggs.length) aggs = [{ fn: "count", as: "count" }];
  const aggCols = aggs.map((a) => (a.column ? resolve(a.column, `aggregate "${a.as}"`) : null));
  aggs.forEach((a, i) => {
    const col = aggCols[i];
    if (col && ["sum", "avg", "min", "max", "median"].includes(a.fn) && cols.get(col)?.type !== "number") {
      throw new QueryError(q.id, `cannot ${a.fn}() column "${col}": it is ${cols.get(col)?.type}, not numeric.`);
    }
  });

  let rows: Row[];
  let columns: ResultColumn[];

  if (groups.length || aggs.length) {
    const buckets = new Map<string, { key: Row; rows: Row[] }>();
    for (const r of matched) {
      const key: Row = {};
      for (const g of groups) {
        const v = r[g.source];
        key[g.as] = g.bucket && typeof v === "string" ? bucketDate(v, g.bucket) : v;
      }
      const k = JSON.stringify(groups.map((g) => key[g.as]));
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = { key, rows: [] }));
      b.rows.push(r);
    }
    if (!groups.length && !buckets.size) buckets.set("[]", { key: {}, rows: [] });
    rows = [...buckets.values()].map(({ key, rows: members }) => {
      const out: Row = { ...key };
      aggs.forEach((a, i) => (out[a.as] = aggregate(members, a, aggCols[i])));
      return out;
    });
    columns = [
      ...groups.map((g): ResultColumn => ({
        name: g.as,
        type: g.bucket ? "category" : (cols.get(g.source)?.type ?? "category"),
        role: "dimension",
      })),
      ...aggs.map((a): ResultColumn => ({ name: a.as, type: "number", role: "measure" })),
    ];
    if (!q.sort?.length) {
      rows.sort((a, b) => {
        for (const g of groups) {
          const c = compareCells(a[g.as], b[g.as]);
          if (c) return c;
        }
        return 0;
      });
    }
  } else {
    const select = (q.select?.length ? q.select : ds.columns.map((c) => c.name)).map((s) => resolve(s, "select"));
    rows = matched.map((r) => Object.fromEntries(select.map((s) => [s, r[s]])));
    columns = select.map((s) => ({
      name: s,
      type: cols.get(s)!.type,
      role: cols.get(s)!.type === "number" ? "measure" : "dimension",
    }));
  }

  const computed = q.computed ?? [];
  const early = computed.filter((c) => c.op !== "pct_change_prev");
  const late = computed.filter((c) => c.op === "pct_change_prev");
  const addComputedColumns = (list: Computed[]) => {
    for (const c of list) columns.push({ name: c.as, type: "number", role: "measure" });
  };
  const resultResolve = () => makeResolver(q.id, columns);

  for (const c of early) {
    applyComputed(rows, c, resultResolve());
    addComputedColumns([c]);
  }

  if (q.sort?.length) {
    const sorts = q.sort.map((s) => ({ by: resultResolve()(s.by, "sort"), dir: s.dir ?? "asc" }));
    rows.sort((a, b) => {
      for (const s of sorts) {
        const c = compareCells(a[s.by], b[s.by]);
        if (c) return s.dir === "desc" ? -c : c;
      }
      return 0;
    });
  }

  for (const c of late) {
    applyComputed(rows, c, resultResolve());
    addComputedColumns([c]);
  }

  if (q.limit) rows = rows.slice(0, q.limit);

  return { id: q.id, title: q.title, columns, rows, matchedRows: matched.length, sql: toSql(q) };
}

export function executePlan(ds: Dataset, queries: Query[]): Record<string, QueryResult> {
  const ids = new Set<string>();
  const out: Record<string, QueryResult> = {};
  for (const q of queries) {
    if (ids.has(q.id)) throw new QueryError(q.id, "duplicate query id.");
    ids.add(q.id);
    out[q.id] = executeQuery(ds, q);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pseudo-SQL rendering, so humans can audit exactly what ran.

const lit = (v: unknown): string =>
  typeof v === "number" || typeof v === "boolean" ? String(v) : `'${String(v).replace(/'/g, "''")}'`;

function filterSql(filter: Filter): string {
  const f = filter.bucket ? { ...filter, column: `${filter.bucket}(${filter.column})` } : filter;
  const list = Array.isArray(f.value) ? f.value : [f.value];
  const ops: Record<string, string> = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" };
  switch (f.op) {
    case "is_null":
      return `${f.column} IS NULL`;
    case "not_null":
      return `${f.column} IS NOT NULL`;
    case "in":
    case "not_in":
      return `${f.column} ${f.op === "in" ? "IN" : "NOT IN"} (${list.map(lit).join(", ")})`;
    case "contains":
      return `${f.column} ILIKE ${lit(`%${list[0]}%`)}`;
    case "between":
      return `${f.column} BETWEEN ${lit(list[0])} AND ${lit(list[1])}`;
    default:
      return `${f.column} ${ops[f.op]} ${lit(list[0])}`;
  }
}

export function toSql(q: Query): string {
  const groups = (q.groupBy ?? []).map((g) =>
    typeof g === "string" ? { expr: g, as: g } : { expr: `${g.bucket}(${g.column})`, as: g.as ?? `${g.column}_${g.bucket}` },
  );
  let aggs = q.aggregates ?? [];
  if (groups.length && !aggs.length) aggs = [{ fn: "count", as: "count" }];
  const select: string[] = [];
  if (groups.length || aggs.length) {
    select.push(...groups.map((g) => (g.expr === g.as ? g.expr : `${g.expr} AS ${g.as}`)));
    select.push(
      ...aggs.map((a) =>
        a.fn === "count_distinct"
          ? `COUNT(DISTINCT ${a.column}) AS ${a.as}`
          : `${a.fn.toUpperCase()}(${a.column ?? "*"}) AS ${a.as}`,
      ),
    );
  } else {
    select.push(...(q.select?.length ? q.select : ["*"]));
  }
  const sym: Record<string, string> = { add: "+", sub: "-", mul: "*", div: "/" };
  for (const c of q.computed ?? []) {
    if (c.op === "pct_of_total") select.push(`100.0 * ${c.left} / SUM(${c.left}) OVER () AS ${c.as}`);
    else if (c.op === "pct_change_prev")
      select.push(`100.0 * (${c.left} - LAG(${c.left})) / LAG(${c.left}) OVER () AS ${c.as}`);
    else select.push(`${c.left} ${sym[c.op]} ${c.right} AS ${c.as}`);
  }
  const lines = [`SELECT ${select.join(",\n       ")}`, "FROM data"];
  if (q.filters?.length) lines.push(`WHERE ${q.filters.map(filterSql).join("\n  AND ")}`);
  if (groups.length) lines.push(`GROUP BY ${groups.map((g) => g.as).join(", ")}`);
  if (q.sort?.length) lines.push(`ORDER BY ${q.sort.map((s) => `${s.by} ${(s.dir ?? "asc").toUpperCase()}`).join(", ")}`);
  if (q.limit) lines.push(`LIMIT ${q.limit}`);
  return lines.join("\n");
}
