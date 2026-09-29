"use client";

import clsx from "clsx";
import { Database, FileUp, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { formatNumber } from "@/lib/format";
import { SAMPLES } from "@/lib/samples";
import { useActiveDataset, useStore } from "@/lib/store";
import type { ColumnProfile } from "@/lib/types";
import { TypeIcon } from "./TypeIcon";
import { Spinner } from "./ui";

function Histogram({ bins }: { bins: number[] }) {
  const max = Math.max(...bins, 1);
  return (
    <svg viewBox={`0 0 ${bins.length * 4} 16`} className="h-4 w-12 shrink-0" preserveAspectRatio="none" aria-hidden>
      {bins.map((b, i) => {
        const h = Math.max(1, (b / max) * 16);
        return <rect key={i} x={i * 4} y={16 - h} width={3} height={h} className="fill-brand/60" />;
      })}
    </svg>
  );
}

function ColumnRow({ col, rowCount }: { col: ColumnProfile; rowCount: number }) {
  const [open, setOpen] = useState(false);
  const nullPct = rowCount ? (col.nullCount / rowCount) * 100 : 0;
  return (
    <li>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-panel-2"
      >
        <TypeIcon type={col.type} />
        <span className="min-w-0 flex-1 truncate font-mono">{col.name}</span>
        {col.numeric ? (
          <Histogram bins={col.numeric.histogram} />
        ) : (
          <span className="shrink-0 text-[10px] text-faint">{col.distinctCount.toLocaleString()}</span>
        )}
      </button>
      {open && (
        <div className="mx-2 mb-2 space-y-1 rounded-md border border-border bg-panel-2/60 p-2 text-[11px] text-muted">
          <div className="flex justify-between">
            <span>type</span>
            <span className="text-text">{col.type}</span>
          </div>
          <div className="flex justify-between">
            <span>distinct</span>
            <span className="text-text">{col.distinctCount.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span>empty</span>
            <span className={clsx(nullPct > 0 ? "text-warn" : "text-text")}>{formatNumber(nullPct, "percent")}</span>
          </div>
          {col.numeric && (
            <>
              <div className="flex justify-between">
                <span>range</span>
                <span className="font-mono text-text">
                  {formatNumber(col.numeric.min, "number", true)} – {formatNumber(col.numeric.max, "number", true)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>mean</span>
                <span className="font-mono text-text">{formatNumber(col.numeric.mean)}</span>
              </div>
            </>
          )}
          {col.dateRange && (
            <div className="flex justify-between gap-2">
              <span>range</span>
              <span className="font-mono text-text">
                {col.dateRange.min.slice(0, 10)} → {col.dateRange.max.slice(0, 10)}
              </span>
            </div>
          )}
          {col.topValues && (
            <div className="pt-1">
              {col.topValues.slice(0, 5).map((v) => (
                <div key={v.value} className="flex justify-between gap-2">
                  <span className="truncate text-text">{v.value}</span>
                  <span className="font-mono">{v.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function Sidebar({ onPick }: { onPick?: () => void }) {
  const datasets = useStore((s) => s.datasets);
  const loading = useStore((s) => s.loading);
  const activeId = useStore((s) => s.activeDatasetId);
  const selectSample = useStore((s) => s.selectSample);
  const setActive = useStore((s) => s.setActive);
  const upload = useStore((s) => s.upload);
  const active = useActiveDataset();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const uploads = Object.values(datasets).filter((d) => d.source === "upload");

  return (
    <aside className="flex h-full w-full flex-col gap-5 overflow-y-auto p-4">
      <section>
        <h2 className="mb-2 px-2 text-[11px] font-semibold tracking-wider text-faint uppercase">Datasets</h2>
        <ul className="space-y-0.5">
          {SAMPLES.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => {
                  selectSample(s.id);
                  onPick?.();
                }}
                className={clsx(
                  "flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors",
                  activeId === s.id ? "bg-brand-soft" : "hover:bg-panel-2",
                )}
              >
                <Database className={clsx("mt-0.5 size-3.5 shrink-0", activeId === s.id ? "text-brand" : "text-faint")} />
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {s.name}
                    {loading[s.id] && <Spinner className="size-3" />}
                  </span>
                  <span className="block text-xs leading-snug text-muted">{s.description}</span>
                </span>
              </button>
            </li>
          ))}
          {uploads.map((d) => (
            <li key={d.id}>
              <button
                onClick={() => {
                  setActive(d.id);
                  onPick?.();
                }}
                className={clsx(
                  "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm font-medium",
                  activeId === d.id ? "bg-brand-soft" : "hover:bg-panel-2",
                )}
              >
                <FileUp className={clsx("size-3.5 shrink-0", activeId === d.id ? "text-brand" : "text-faint")} />
                <span className="truncate">{d.name}</span>
                <span className="ml-auto text-xs font-normal text-faint">{d.rows.length.toLocaleString()}</span>
              </button>
            </li>
          ))}
        </ul>
        <button
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files[0];
            if (f) upload(f).then(() => onPick?.());
          }}
          className={clsx(
            "mt-2 flex w-full flex-col items-center gap-1 rounded-lg border border-dashed px-3 py-4 text-xs transition-colors",
            dragging ? "border-brand bg-brand-soft text-brand" : "border-border text-muted hover:border-faint hover:text-text",
          )}
        >
          <Upload className="size-4" />
          <span>
            Drop a CSV or <span className="text-brand">browse</span>
          </span>
          <span className="text-[10px] text-faint">Parsed in your browser, never uploaded</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f).then(() => onPick?.());
            e.target.value = "";
          }}
        />
      </section>

      {active && (
        <section className="min-h-0">
          <h2 className="mb-2 flex items-baseline justify-between px-2 text-[11px] font-semibold tracking-wider text-faint uppercase">
            <span>Schema</span>
            <span className="font-normal tracking-normal normal-case">
              {active.rows.length.toLocaleString()} rows · {active.columns.length} cols
            </span>
          </h2>
          <ul>
            {active.columns.map((c) => (
              <ColumnRow key={c.name} col={c} rowCount={active.rows.length} />
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
