"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { compareCells } from "@/lib/engine";
import { formatCell } from "@/lib/format";
import type { ColumnType, Row } from "@/lib/types";
import { TypeIcon } from "./TypeIcon";

const ROW_H = 30;

export interface GridColumn {
  name: string;
  type: ColumnType;
}

function widthFor(c: GridColumn): number {
  const base = c.type === "number" ? 110 : c.type === "date" ? 130 : 140;
  return Math.min(260, Math.max(base, c.name.length * 8 + 48));
}

/** Virtualized, sortable grid — renders ~30 DOM rows regardless of dataset size. */
export function DataGrid({
  columns,
  rows,
  highlight,
  maxHeight = 480,
  className,
}: {
  columns: GridColumn[];
  rows: Row[];
  highlight?: Set<number>;
  maxHeight?: number | string;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 } | null>(null);

  const order = useMemo(() => {
    const idx = rows.map((_, i) => i);
    if (sort) idx.sort((a, b) => compareCells(rows[a][sort.col], rows[b][sort.col]) * sort.dir);
    return idx;
  }, [rows, sort]);

  const widths = useMemo(() => columns.map(widthFor), [columns]);
  const total = widths.reduce((a, b) => a + b, 48);

  // eslint-disable-next-line react-hooks/incompatible-library -- virtualizer state is read fresh each render
  const virtualizer = useVirtualizer({
    count: order.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  });

  // Bring the first highlighted row into view.
  useEffect(() => {
    if (!highlight?.size) return;
    const pos = order.findIndex((i) => highlight.has(i));
    if (pos >= 0) virtualizer.scrollToIndex(pos, { align: "center" });
  }, [highlight, order, virtualizer]);

  const toggleSort = (col: string) =>
    setSort((s) => (s?.col !== col ? { col, dir: 1 } : s.dir === 1 ? { col, dir: -1 } : null));

  return (
    <div
      ref={scrollRef}
      className={clsx("relative overflow-auto rounded-lg border border-border bg-panel text-xs", className)}
      style={{ maxHeight }}
    >
      <div style={{ width: total, minWidth: "100%" }}>
        <div className="sticky top-0 z-10 flex border-b border-border bg-panel-2 font-medium text-muted">
          <div className="w-12 shrink-0 px-2 py-2 text-right text-faint">#</div>
          {columns.map((c, i) => (
            <button
              key={c.name}
              onClick={() => toggleSort(c.name)}
              style={{ width: widths[i] }}
              className={clsx(
                "flex shrink-0 items-center gap-1.5 px-2 py-2 hover:text-text",
                c.type === "number" && "flex-row-reverse text-right",
              )}
            >
              <TypeIcon type={c.type} />
              <span className="truncate">{c.name}</span>
              {sort?.col === c.name && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
            </button>
          ))}
        </div>
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((v) => {
            const rowIndex = order[v.index];
            const row = rows[rowIndex];
            const hot = highlight?.has(rowIndex);
            return (
              <div
                key={v.key}
                className={clsx(
                  "absolute left-0 flex w-full border-b border-border/60 font-mono tabular-nums transition-colors",
                  hot ? "bg-brand-soft" : v.index % 2 ? "bg-panel-2/40" : "",
                )}
                style={{ height: ROW_H, transform: `translateY(${v.start}px)` }}
              >
                <div className={clsx("w-12 shrink-0 px-2 py-1.5 text-right", hot ? "text-brand" : "text-faint")}>
                  {rowIndex + 1}
                </div>
                {columns.map((c, i) => {
                  const val = row[c.name];
                  return (
                    <div
                      key={c.name}
                      style={{ width: widths[i] }}
                      title={val === null ? "empty" : String(val)}
                      className={clsx(
                        "shrink-0 truncate px-2 py-1.5",
                        c.type === "number" && "text-right",
                        val === null && "text-faint",
                      )}
                    >
                      {formatCell(val)}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {rows.length === 0 && <div className="p-6 text-center text-muted">No rows.</div>}
    </div>
  );
}
