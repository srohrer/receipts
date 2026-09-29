import { describe, expect, it } from "vitest";
import { buildDataset, inferType, parseDate, parseNumber } from "../csv";
import { bucketDate, executeQuery, QueryError, toSql } from "../engine";

const ds = buildDataset(
  [
    { month: "2024-01", region: "West", revenue: "$1,000", units: "10", note: "a" },
    { month: "2024-02", region: "West", revenue: "1500", units: "15", note: "" },
    { month: "2024-01", region: "East", revenue: "500", units: "5", note: "b" },
    { month: "2024-02", region: "East", revenue: "250", units: "", note: "c" },
    { month: "2025-01", region: "East", revenue: "750", units: "8", note: "d" },
  ],
  { id: "t", name: "test", source: "sample" },
);

describe("csv inference", () => {
  it("parses numbers with currency and separators", () => {
    expect(parseNumber("$1,234.50")).toBe(1234.5);
    expect(parseNumber("12%")).toBe(12);
    expect(parseNumber("abc")).toBeNull();
  });
  it("normalizes dates", () => {
    expect(parseDate("2024-03")).toBe("2024-03-01");
    expect(parseDate("3/7/2024")).toBe("2024-03-07");
    expect(parseDate("2024-03-07T09:15:00Z")).toBe("2024-03-07 09:15");
    expect(parseDate("2024-13-01")).toBeNull();
  });
  it("infers column types", () => {
    expect(inferType(["1", "2", "3.5", ""])).toBe("number");
    expect(inferType(["true", "false"])).toBe("boolean");
    const types = Object.fromEntries(ds.columns.map((c) => [c.name, c.type]));
    expect(types).toMatchObject({ month: "date", region: "category", revenue: "number", units: "number" });
    expect(ds.columns.find((c) => c.name === "units")!.nullCount).toBe(1);
  });
});

describe("engine", () => {
  it("groups and aggregates", () => {
    const r = executeQuery(ds, {
      id: "q1",
      title: "by region",
      groupBy: ["region"],
      aggregates: [
        { fn: "sum", column: "revenue", as: "rev" },
        { fn: "avg", column: "units", as: "avg_units" },
        { fn: "count", as: "n" },
      ],
      sort: [{ by: "rev", dir: "desc" }],
    });
    expect(r.rows).toEqual([
      { region: "West", rev: 2500, avg_units: 12.5, n: 2 },
      { region: "East", rev: 1500, avg_units: 6.5, n: 3 },
    ]);
  });

  it("buckets dates and filters", () => {
    const r = executeQuery(ds, {
      id: "q2",
      title: "yearly",
      filters: [{ column: "region", op: "eq", value: "east" }],
      groupBy: [{ column: "month", bucket: "year" }],
      aggregates: [{ fn: "sum", column: "revenue", as: "rev" }],
    });
    expect(r.matchedRows).toBe(3);
    expect(r.rows).toEqual([
      { month_year: "2024", rev: 750 },
      { month_year: "2025", rev: 750 },
    ]);
  });

  it("supports computed columns including pct_of_total and pct_change_prev", () => {
    const r = executeQuery(ds, {
      id: "q3",
      title: "monthly",
      groupBy: [{ column: "month", bucket: "month", as: "m" }],
      aggregates: [
        { fn: "sum", column: "revenue", as: "rev" },
        { fn: "sum", column: "units", as: "u" },
      ],
      computed: [
        { as: "rev_per_unit", op: "div", left: "rev", right: "u" },
        { as: "share", op: "pct_of_total", left: "rev" },
        { as: "mom", op: "pct_change_prev", left: "rev" },
      ],
    });
    expect(r.rows.map((x) => x.m)).toEqual(["2024-01", "2024-02", "2025-01"]);
    expect(r.rows[0].rev_per_unit).toBe(100);
    expect(r.rows[0].share).toBeCloseTo(37.5);
    expect(r.rows[0].mom).toBeNull();
    expect(r.rows[1].mom).toBeCloseTo(16.6667, 3);
  });

  it("returns a single row for global aggregates, even with no matches", () => {
    const r = executeQuery(ds, {
      id: "q4",
      title: "none",
      filters: [{ column: "region", op: "eq", value: "Mars" }],
      aggregates: [{ fn: "count", as: "n" }],
    });
    expect(r.rows).toEqual([{ n: 0 }]);
  });

  it("raises actionable errors for bad columns", () => {
    expect(() =>
      executeQuery(ds, { id: "bad", title: "x", aggregates: [{ fn: "sum", column: "revnue", as: "r" }] }),
    ).toThrow(QueryError);
    expect(() =>
      executeQuery(ds, { id: "bad", title: "x", aggregates: [{ fn: "sum", column: "region", as: "r" }] }),
    ).toThrow(/not numeric/);
  });

  it("bucket helpers", () => {
    expect(bucketDate("2025-05-14", "quarter")).toBe("2025-Q2");
    expect(bucketDate("2025-05-14", "weekday")).toBe("Wed");
    expect(bucketDate("2025-01-01", "week")).toBe("2025-W01");
    expect(bucketDate("2025-05-14 17:30", "hour")).toBe("17");
  });

  it("renders auditable SQL", () => {
    const sql = toSql({
      id: "q",
      title: "t",
      filters: [{ column: "region", op: "in", value: ["West", "East"] }],
      groupBy: [{ column: "month", bucket: "quarter" }],
      aggregates: [{ fn: "count_distinct", column: "region", as: "regions" }],
      limit: 5,
    });
    expect(sql).toContain("quarter(month) AS month_quarter");
    expect(sql).toContain("COUNT(DISTINCT region) AS regions");
    expect(sql).toContain("WHERE region IN ('West', 'East')");
    expect(sql).toContain("LIMIT 5");
  });
});
