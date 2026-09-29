"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartSpec } from "@/lib/dsl";
import type { QueryResult } from "@/lib/engine";
import { formatNumber } from "@/lib/format";
import type { Evidence } from "@/lib/verify";
import { SERIES_COLORS, useChartColors } from "./useTheme";

interface Prepared {
  data: Record<string, string | number | null>[];
  keys: string[];
}

/** Pivots long-format results (x, series, y) into one column per series for recharts. */
function prepare(spec: ChartSpec, result: QueryResult): Prepared {
  if (spec.series) {
    const keys: string[] = [];
    const byX = new Map<string, Record<string, string | number | null>>();
    for (const r of result.rows) {
      const x = String(r[spec.x]);
      const s = String(r[spec.series]);
      if (!keys.includes(s)) keys.push(s);
      if (!byX.has(x)) byX.set(x, { __x: x });
      const v = r[spec.y[0]];
      byX.get(x)![s] = typeof v === "number" ? v : null;
    }
    return { data: [...byX.values()], keys };
  }
  return {
    data: result.rows.map((r) => {
      const out: Record<string, string | number | null> = { __x: r[spec.x] as string | number | null };
      for (const y of spec.y) out[y] = typeof r[y] === "number" ? (r[y] as number) : null;
      return out;
    }),
    keys: spec.y,
  };
}

interface HotEntry {
  x?: string;
  k?: string;
}

/**
 * Maps claim evidence onto chart marks. Evidence from the chart's own query maps
 * exactly; evidence from a supporting query maps through shared dimension values
 * (e.g. a claim about region = "APAC" in another query lights up the APAC series).
 */
function hotEntries(spec: ChartSpec, result: QueryResult, evidence: Evidence[] | undefined, results?: Record<string, QueryResult>): HotEntry[] {
  const out: HotEntry[] = [];
  for (const ev of evidence ?? []) {
    const src = ev.query === result.id ? result : results?.[ev.query];
    if (!src) continue;
    for (const i of ev.rows) {
      const row = src.rows[i];
      if (!row) continue;
      const e: HotEntry = {};
      if (spec.x in row) e.x = String(row[spec.x]);
      if (spec.series) {
        if (spec.series in row) e.k = String(row[spec.series]);
      } else if (ev.field && spec.y.includes(ev.field)) {
        e.k = ev.field;
      }
      if (e.x !== undefined || e.k !== undefined) out.push(e);
    }
  }
  return out;
}

export function ChartView({
  spec,
  result,
  evidence,
  results,
  height = 280,
}: {
  spec: ChartSpec;
  result: QueryResult;
  evidence?: Evidence[];
  /** all results of the analysis, so evidence from supporting queries can be mapped */
  results?: Record<string, QueryResult>;
  height?: number;
}) {
  const c = useChartColors();
  const { data, keys } = useMemo(() => prepare(spec, result), [spec, result]);
  const hot = useMemo(() => hotEntries(spec, result, evidence, results), [spec, result, evidence, results]);
  const anyHot = hot.length > 0;
  const isHot = (x: unknown, k: string) =>
    hot.some((e) => (e.x === undefined || e.x === String(x)) && (e.k === undefined || e.k === k));
  /** a specific point (not a whole series) is referenced */
  const isPointHot = (x: unknown, k: string) =>
    hot.some((e) => e.x === String(x) && (e.k === undefined || e.k === k));
  const fmt = (v: unknown) => (typeof v === "number" ? formatNumber(v, spec.yFormat ?? "number", true) : String(v));
  const colorOf = (i: number) => SERIES_COLORS[i % SERIES_COLORS.length];

  const axisProps = {
    stroke: c.axis,
    tick: { fill: c.text, fontSize: 11 },
    tickLine: false,
    axisLine: { stroke: c.border },
  };
  const tooltip = (
    <Tooltip
      cursor={{ fill: c.grid, stroke: c.border }}
      contentStyle={{ background: c.panel, border: `1px solid ${c.border}`, borderRadius: 8, fontSize: 12, color: c.fg }}
      labelStyle={{ color: c.text, marginBottom: 4 }}
      formatter={(v) => (typeof v === "number" ? formatNumber(v, spec.yFormat ?? "number") : String(v))}
    />
  );
  const legend = keys.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: c.text }} iconSize={8} />;
  const grid = <CartesianGrid stroke={c.grid} vertical={false} />;

  let chart: React.ReactElement;
  switch (spec.type) {
    case "pie": {
      const y = spec.y[0];
      const slices = result.rows.map((r) => ({ name: String(r[spec.x]), value: typeof r[y] === "number" ? (r[y] as number) : 0 }));
      chart = (
        <PieChart>
          <Pie data={slices} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={1} stroke={c.panel}>
            {slices.map((s, i) => (
              <Cell key={s.name} fill={colorOf(i)} fillOpacity={anyHot && !isHot(s.name, y) ? 0.25 : 1} />
            ))}
          </Pie>
          {tooltip}
          <Legend wrapperStyle={{ fontSize: 11, color: c.text }} iconSize={8} />
        </PieChart>
      );
      break;
    }
    case "scatter": {
      const y = spec.y[0];
      chart = (
        <ScatterChart margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          {grid}
          <XAxis dataKey="__x" type="number" name={spec.x} {...axisProps} tickFormatter={(v) => formatNumber(v, "number", true)} />
          <YAxis dataKey={y} type="number" name={y} {...axisProps} width={56} tickFormatter={fmt} />
          {tooltip}
          <Scatter data={data} fill={colorOf(0)}>
            {data.map((d, i) => (
              <Cell key={i} fillOpacity={anyHot && !isHot(d.__x, y) ? 0.15 : 0.8} />
            ))}
          </Scatter>
        </ScatterChart>
      );
      break;
    }
    case "bar": {
      const horizontal = Boolean(spec.horizontal);
      chart = (
        <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid stroke={c.grid} vertical={horizontal} horizontal={!horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" {...axisProps} tickFormatter={fmt} />
              <YAxis type="category" dataKey="__x" {...axisProps} width={110} />
            </>
          ) : (
            <>
              <XAxis dataKey="__x" {...axisProps} minTickGap={8} />
              <YAxis {...axisProps} width={56} tickFormatter={fmt} />
            </>
          )}
          {tooltip}
          {legend}
          {keys.map((k, ki) => (
            <Bar
              key={k}
              dataKey={k}
              name={k}
              fill={colorOf(ki)}
              stackId={spec.stacked ? "s" : undefined}
              radius={spec.stacked ? 0 : horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]}
              maxBarSize={48}
              isAnimationActive={false}
            >
              {data.map((d, i) => (
                <Cell
                  key={i}
                  fillOpacity={anyHot && !isHot(d.__x, k) ? 0.2 : 1}
                  stroke={anyHot && isHot(d.__x, k) ? c.fg : undefined}
                  strokeWidth={anyHot && isHot(d.__x, k) ? 1.5 : 0}
                />
              ))}
            </Bar>
          ))}
        </BarChart>
      );
      break;
    }
    default: {
      const Chart = spec.type === "area" ? AreaChart : LineChart;
      chart = (
        <Chart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          {grid}
          <XAxis dataKey="__x" {...axisProps} minTickGap={24} />
          <YAxis {...axisProps} width={56} tickFormatter={fmt} />
          {tooltip}
          {legend}
          {keys.map((k, ki) => {
            const color = colorOf(ki);
            const dim = anyHot && !data.some((d) => isHot(d.__x, k));
            const dot = (p: { cx?: number; cy?: number; index?: number; payload?: Record<string, unknown> }) => {
              const on = anyHot && p.payload && isPointHot(p.payload.__x, k);
              return (
                <circle
                  key={`${k}-${p.index}`}
                  cx={p.cx}
                  cy={p.cy}
                  r={on ? 5 : 0}
                  fill={color}
                  stroke={c.panel}
                  strokeWidth={2}
                />
              );
            };
            return spec.type === "area" ? (
              <Area
                key={k}
                type="monotone"
                dataKey={k}
                name={k}
                stroke={color}
                fill={color}
                fillOpacity={dim ? 0.04 : 0.15}
                strokeOpacity={dim ? 0.25 : 1}
                stackId={spec.stacked ? "s" : undefined}
                dot={dot}
                isAnimationActive={false}
              />
            ) : (
              <Line
                key={k}
                type="monotone"
                dataKey={k}
                name={k}
                stroke={color}
                strokeWidth={2}
                strokeOpacity={dim ? 0.2 : 1}
                dot={dot}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
                connectNulls
              />
            );
          })}
        </Chart>
      );
    }
  }

  return (
    <figure>
      <figcaption className="mb-2 text-xs font-medium text-muted">{spec.title}</figcaption>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {chart}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
