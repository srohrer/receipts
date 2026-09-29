"use client";

import { useMemo } from "react";
import type { Plan } from "@/lib/dsl";
import type { QueryResult } from "@/lib/engine";
import type { Evidence } from "@/lib/verify";
import { DataGrid } from "./DataGrid";

const KEYWORDS = /\b(SELECT|FROM|WHERE|AND|GROUP BY|ORDER BY|LIMIT|AS|IN|NOT IN|BETWEEN|IS NULL|IS NOT NULL|ILIKE|OVER|ASC|DESC|DISTINCT)\b/g;

function Sql({ sql }: { sql: string }) {
  const parts = sql.split(/('(?:[^']|'')*')/g);
  return (
    <pre className="overflow-x-auto rounded-lg border border-border bg-panel-2/60 p-3 font-mono text-[11px] leading-relaxed text-muted">
      {parts.map((p, i) =>
        p.startsWith("'") ? (
          <span key={i} className="text-ok">
            {p}
          </span>
        ) : (
          p.split(KEYWORDS).map((t, j) =>
            j % 2 ? (
              <span key={`${i}-${j}`} className="font-semibold text-brand">
                {t}
              </span>
            ) : (
              <span key={`${i}-${j}`} className="text-text/80">
                {t}
              </span>
            ),
          )
        ),
      )}
    </pre>
  );
}

export function QueriesPanel({
  plan,
  results,
  evidence,
}: {
  plan: Plan;
  results: Record<string, QueryResult>;
  evidence?: Evidence[];
}) {
  const hot = useMemo(() => {
    const m = new Map<string, Set<number>>();
    for (const e of evidence ?? []) {
      const s = m.get(e.query) ?? new Set<number>();
      e.rows.forEach((r) => s.add(r));
      m.set(e.query, s);
    }
    return m;
  }, [evidence]);

  return (
    <div className="space-y-5 p-3">
      {plan.assumptions?.length ? (
        <div className="text-xs text-muted">
          <span className="font-medium text-text">Assumptions: </span>
          {plan.assumptions.join(" ")}
        </div>
      ) : null}
      {plan.queries.map((q) => {
        const r = results[q.id];
        if (!r) return null;
        return (
          <section key={q.id} className="space-y-2">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <div>
                <span className="font-mono text-brand">{q.id}</span>
                <span className="ml-2 font-medium">{q.title}</span>
              </div>
              <span className="shrink-0 text-faint">
                {r.matchedRows.toLocaleString()} rows matched → {r.rows.length.toLocaleString()} results
              </span>
            </div>
            <Sql sql={r.sql} />
            <DataGrid columns={r.columns} rows={r.rows} highlight={hot.get(q.id)} maxHeight={260} />
          </section>
        );
      })}
    </div>
  );
}
