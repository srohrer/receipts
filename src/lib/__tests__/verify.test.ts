import { describe, expect, it } from "vitest";
import type { Claim } from "../dsl";
import type { QueryResult } from "../engine";
import { tolerance, verifyAll, withinTolerance } from "../verify";

const results: Record<string, QueryResult> = {
  by_region: {
    id: "by_region",
    title: "Revenue by region",
    matchedRows: 100,
    sql: "",
    columns: [
      { name: "region", type: "category", role: "dimension" },
      { name: "revenue", type: "number", role: "measure" },
    ],
    rows: [
      { region: "APAC", revenue: 1_234_567 },
      { region: "EMEA", revenue: 800_000 },
      { region: "LATAM", revenue: 165_433 },
    ],
  },
  by_year: {
    id: "by_year",
    title: "Revenue by year",
    matchedRows: 100,
    sql: "",
    columns: [
      { name: "year", type: "category", role: "dimension" },
      { name: "revenue", type: "number", role: "measure" },
    ],
    rows: [
      { year: "2023", revenue: 100 },
      { year: "2024", revenue: 114.4 },
      { year: "2025", revenue: 131 },
    ],
  },
};

const claim = (id: string, check: Claim["check"]): Claim => ({ id, statement: id, check });

describe("rounding-semantics tolerance", () => {
  it("derives precision from how the number is written", () => {
    expect(tolerance(14)).toBe(0.5);
    expect(tolerance(14.4)).toBeCloseTo(0.05);
    expect(tolerance(1_200_000)).toBe(50_000);
    expect(tolerance(100)).toBe(0.5); // small round numbers stay strict
  });
  it("caps the tolerance at 5% so vague numbers can't slip through", () => {
    expect(tolerance(2000)).toBe(100);
    expect(withinTolerance(1_234_567, 1_200_000)).toBe(true);
    expect(withinTolerance(1_234_567, 1_000_000)).toBe(false);
  });
});

describe("verifyAll", () => {
  it("grades each check type", () => {
    const v = verifyAll(
      [
        claim("value_ok", { type: "value", ref: { query: "by_region", where: { region: "apac" }, field: "revenue" }, expected: 1_200_000 }),
        claim("pct_ok", {
          type: "pct_change",
          from: { query: "by_year", where: { year: "2023" }, field: "revenue" },
          to: { query: "by_year", where: { year: "2024" }, field: "revenue" },
          expected: 14,
        }),
        claim("pct_bad", {
          type: "pct_change",
          from: { query: "by_year", where: { year: "2023" }, field: "revenue" },
          to: { query: "by_year", where: { year: "2025" }, field: "revenue" },
          expected: 21,
        }),
        claim("share_ok", { type: "share", ref: { query: "by_region", where: { region: "APAC" }, field: "revenue" }, expected: 56 }),
        claim("rank_ok", { type: "rank", ref: { query: "by_region", where: { region: "LATAM" }, field: "revenue" }, rank: 3 }),
        claim("rank_bad", { type: "rank", ref: { query: "by_region", where: { region: "EMEA" }, field: "revenue" }, rank: 1 }),
        claim("trend_ok", { type: "trend", query: "by_year", x: "year", field: "revenue", direction: "up" }),
        claim("compare_ok", {
          type: "compare",
          left: { query: "by_region", where: { region: "EMEA" }, field: "revenue" },
          right: { query: "by_region", where: { region: "LATAM" }, field: "revenue" },
          op: "gt",
        }),
        claim("ratio_ok", {
          type: "ratio",
          numerator: { query: "by_region", where: { region: "EMEA" }, field: "revenue" },
          denominator: { query: "by_region", where: { region: "LATAM" }, field: "revenue" },
          expected: 4.8,
        }),
        claim("count_ok", { type: "count", query: "by_region", expected: 3 }),
        claim("missing_row", { type: "value", ref: { query: "by_region", where: { region: "Mars" }, field: "revenue" }, expected: 1 }),
        claim("missing_query", { type: "count", query: "nope", expected: 1 }),
        claim("ambiguous", { type: "value", ref: { query: "by_region", field: "revenue" }, expected: 1 }),
      ],
      results,
    );
    const status = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.status]));
    expect(status).toEqual({
      value_ok: "verified",
      pct_ok: "verified",
      pct_bad: "contradicted",
      share_ok: "verified",
      rank_ok: "verified",
      rank_bad: "contradicted",
      trend_ok: "verified",
      compare_ok: "verified",
      ratio_ok: "verified",
      count_ok: "verified",
      missing_row: "unverifiable",
      missing_query: "unverifiable",
      ambiguous: "unverifiable",
    });
    expect(v.pct_bad.actual).toBe("31%");
    expect(v.rank_bad.actual).toBe("#2 of 3");
    expect(v.value_ok.evidence[0]).toEqual({ query: "by_region", rows: [0], field: "revenue" });
  });
});
