/**
 * Symbolic verification of model claims. Each claim carries a typed assertion; we
 * re-derive the asserted quantity from the executed query results and grade it.
 *
 * Numbers are graded with *rounding semantics*: "grew 14%" is verified iff the true
 * value rounds to 14 at the precision the model chose to state. The tolerance is
 * derived from the stated number itself and capped at 5% relative, so the model can't
 * loosen its own grading by writing vaguer numbers.
 */
import type { Check, Claim, Ref } from "./dsl";
import { compareCells, looseEquals, type QueryResult } from "./engine";
import { formatNumber } from "./format";
import type { Cell } from "./types";

export type VerdictStatus = "verified" | "contradicted" | "unverifiable";

export interface Evidence {
  query: string;
  rows: number[];
  field?: string;
}

export interface Verdict {
  claimId: string;
  status: VerdictStatus;
  /** plain-English restatement of what was checked */
  check: string;
  expected?: string;
  actual?: string;
  note?: string;
  evidence: Evidence[];
}

type Results = Record<string, QueryResult>;

class Unverifiable extends Error {}

export function tolerance(expected: number): number {
  const abs = Math.abs(expected);
  const s = String(abs);
  let half: number;
  if (s.includes("e")) {
    half = abs * 0.005;
  } else if (s.includes(".")) {
    half = 0.5 * 10 ** -s.split(".")[1].length;
  } else {
    const trailingZeros = abs >= 1000 ? (/0+$/.exec(s)?.[0].length ?? 0) : 0;
    half = 0.5 * 10 ** trailingZeros;
  }
  const capped = Math.min(half, Math.max(0.05 * abs, 0.5));
  return Math.max(capped, 1e-9 * Math.max(1, abs));
}

export const withinTolerance = (actual: number, expected: number) =>
  Math.abs(actual - expected) <= tolerance(expected);

function getResult(results: Results, id: string): QueryResult {
  const r = results[id] ?? Object.values(results).find((q) => q.id.toLowerCase() === id.toLowerCase());
  if (!r) throw new Unverifiable(`references unknown query "${id}"`);
  return r;
}

function resolveField(result: QueryResult, field: string): string {
  const hit = result.columns.find((c) => c.name.toLowerCase() === field.toLowerCase());
  if (!hit) throw new Unverifiable(`query "${result.id}" has no column "${field}"`);
  return hit.name;
}

function matchRows(result: QueryResult, where: Record<string, unknown> | null | undefined): number[] {
  const entries = Object.entries(where ?? {}).map(([k, v]) => [resolveField(result, k), v] as const);
  const idx: number[] = [];
  result.rows.forEach((row, i) => {
    if (entries.every(([k, v]) => looseEquals(row[k], v as Cell))) idx.push(i);
  });
  return idx;
}

function describeWhere(where: Record<string, unknown> | null | undefined): string {
  const e = Object.entries(where ?? {});
  return e.length ? ` where ${e.map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(" and ")}` : "";
}

function describeRef(ref: Ref): string {
  return `${ref.field}${describeWhere(ref.where)} (${ref.query})`;
}

/** Resolves a ref to exactly one numeric value, or explains why it can't. */
function resolveRef(results: Results, ref: Ref): { value: number; evidence: Evidence } {
  const result = getResult(results, ref.query);
  const field = resolveField(result, ref.field);
  const rows = matchRows(result, ref.where);
  if (!rows.length) throw new Unverifiable(`no row in "${result.id}"${describeWhere(ref.where)}`);
  const values = rows.map((i) => result.rows[i][field]);
  const first = values[0];
  if (rows.length > 1 && !values.every((v) => looseEquals(v, first))) {
    throw new Unverifiable(`${rows.length} rows in "${result.id}" match${describeWhere(ref.where)}; the reference is ambiguous`);
  }
  if (typeof first !== "number") throw new Unverifiable(`${describeRef(ref)} is ${first === null ? "empty" : "not numeric"}`);
  return { value: first, evidence: { query: result.id, rows, field } };
}

const pct = (n: number) => formatNumber(n, "percent");

function numericVerdict(
  claimId: string,
  check: string,
  actual: number,
  expected: number,
  evidence: Evidence[],
  fmt: (n: number) => string = (n) => formatNumber(n),
): Verdict {
  return {
    claimId,
    check,
    status: withinTolerance(actual, expected) ? "verified" : "contradicted",
    expected: fmt(expected),
    actual: fmt(actual),
    evidence,
  };
}

function linearSlope(ys: number[]): number {
  const n = ys.length;
  const mx = (n - 1) / 2;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  ys.forEach((y, x) => {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  });
  return den ? num / den : 0;
}

function evaluate(claimId: string, c: Check, results: Results): Verdict {
  switch (c.type) {
    case "value": {
      const { value, evidence } = resolveRef(results, c.ref);
      return numericVerdict(claimId, `${describeRef(c.ref)} ≈ ${formatNumber(c.expected)}`, value, c.expected, [evidence]);
    }
    case "pct_change": {
      const a = resolveRef(results, c.from);
      const b = resolveRef(results, c.to);
      if (a.value === 0) throw new Unverifiable("percent change from zero is undefined");
      const actual = ((b.value - a.value) / Math.abs(a.value)) * 100;
      return numericVerdict(
        claimId,
        `change from ${describeRef(c.from)} to ${describeRef(c.to)}`,
        actual,
        c.expected,
        [a.evidence, b.evidence],
        pct,
      );
    }
    case "ratio": {
      const a = resolveRef(results, c.numerator);
      const b = resolveRef(results, c.denominator);
      if (b.value === 0) throw new Unverifiable("ratio denominator is zero");
      return numericVerdict(
        claimId,
        `${describeRef(c.numerator)} ÷ ${describeRef(c.denominator)}`,
        a.value / b.value,
        c.expected,
        [a.evidence, b.evidence],
        (n) => `${formatNumber(n)}×`,
      );
    }
    case "share": {
      const { value, evidence } = resolveRef(results, c.ref);
      const result = getResult(results, c.ref.query);
      const field = resolveField(result, c.ref.field);
      const total = result.rows.reduce((s, r) => s + (typeof r[field] === "number" ? (r[field] as number) : 0), 0);
      if (total === 0) throw new Unverifiable("column total is zero");
      return numericVerdict(
        claimId,
        `share of ${describeRef(c.ref)} in the column total`,
        (value / total) * 100,
        c.expected,
        [{ ...evidence, rows: result.rows.map((_, i) => i) }],
        pct,
      );
    }
    case "compare": {
      const a = resolveRef(results, c.left);
      const b = resolveRef(results, c.right);
      // "about the same" is graded at 3% relative difference
      const holds =
        c.op === "gt"
          ? a.value > b.value
          : c.op === "lt"
            ? a.value < b.value
            : Math.abs(a.value - b.value) <= 0.03 * Math.max(Math.abs(a.value), Math.abs(b.value));
      const sym = { gt: ">", lt: "<", eq: "≈" }[c.op];
      return {
        claimId,
        check: `${describeRef(c.left)} ${sym} ${describeRef(c.right)}`,
        status: holds ? "verified" : "contradicted",
        expected: `left ${sym} right`,
        actual: `${formatNumber(a.value)} vs ${formatNumber(b.value)}`,
        evidence: [a.evidence, b.evidence],
      };
    }
    case "rank": {
      const { value, evidence } = resolveRef(results, c.ref);
      const result = getResult(results, c.ref.query);
      const field = resolveField(result, c.ref.field);
      const others = result.rows.map((r) => r[field]).filter((v): v is number => typeof v === "number");
      const order = c.order ?? "desc";
      const actual = 1 + others.filter((v) => (order === "desc" ? v > value : v < value)).length;
      return {
        claimId,
        check: `rank of ${describeRef(c.ref)} by ${order === "desc" ? "largest" : "smallest"} ${field}`,
        status: actual === c.rank ? "verified" : "contradicted",
        expected: `#${c.rank}`,
        actual: `#${actual} of ${others.length}`,
        evidence: [evidence],
      };
    }
    case "trend": {
      const result = getResult(results, c.query);
      const x = resolveField(result, c.x);
      const field = resolveField(result, c.field);
      const pts = result.rows
        .map((r, i) => ({ i, x: r[x], y: r[field] }))
        .filter((p): p is { i: number; x: Cell; y: number } => typeof p.y === "number")
        .sort((a, b) => compareCells(a.x, b.x));
      if (pts.length < 3) throw new Unverifiable("a trend needs at least 3 points");
      const ys = pts.map((p) => p.y);
      const meanAbs = ys.reduce((a, b) => a + Math.abs(b), 0) / ys.length || 1;
      const relChange = (linearSlope(ys) * (ys.length - 1)) / meanAbs;
      const actual = relChange > 0.03 ? "up" : relChange < -0.03 ? "down" : "flat";
      return {
        claimId,
        check: `linear trend of ${field} over ${x} (${pts.length} points)`,
        status: actual === c.direction ? "verified" : "contradicted",
        expected: c.direction,
        actual: `${actual} (${relChange >= 0 ? "+" : ""}${formatNumber(relChange * 100, "percent")} across range)`,
        evidence: [{ query: result.id, rows: pts.map((p) => p.i), field }],
      };
    }
    case "count": {
      const result = getResult(results, c.query);
      const rows = matchRows(result, c.where);
      return numericVerdict(claimId, `number of rows in ${result.id}${describeWhere(c.where)}`, rows.length, c.expected, [
        { query: result.id, rows },
      ]);
    }
  }
}

export function verifyClaim(claim: Claim, results: Results): Verdict {
  try {
    return evaluate(claim.id, claim.check, results);
  } catch (e) {
    if (e instanceof Unverifiable) {
      return { claimId: claim.id, status: "unverifiable", check: claim.statement, note: e.message, evidence: [] };
    }
    throw e;
  }
}

export function verifyAll(claims: Claim[], results: Results): Record<string, Verdict> {
  return Object.fromEntries(claims.map((c) => [c.id, verifyClaim(c, results)]));
}

export function score(verdicts: Record<string, Verdict>) {
  const list = Object.values(verdicts);
  return {
    total: list.length,
    verified: list.filter((v) => v.status === "verified").length,
    contradicted: list.filter((v) => v.status === "contradicted").length,
    unverifiable: list.filter((v) => v.status === "unverifiable").length,
  };
}

