import type { Cell } from "./types";

export type NumberFormat = "number" | "currency" | "percent";

export function formatNumber(n: number, format: NumberFormat = "number", compact = false): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const opts: Intl.NumberFormatOptions = {};
  if (compact && abs >= 10_000) {
    opts.notation = "compact";
    opts.maximumFractionDigits = 1;
  } else {
    opts.maximumFractionDigits = abs >= 100 ? 0 : abs >= 1 ? 2 : 4;
  }
  if (format === "currency") {
    return new Intl.NumberFormat("en-US", { ...opts, style: "currency", currency: "USD" }).format(n);
  }
  const s = new Intl.NumberFormat("en-US", opts).format(n);
  return format === "percent" ? `${s}%` : s;
}

export function formatCell(v: Cell): string {
  if (v === null) return "∅";
  if (typeof v === "number") return formatNumber(v);
  return String(v);
}

/** Rounds to a fixed number of significant digits — used when handing results to the model. */
export function roundSig(n: number, digits = 6): number {
  if (n === 0 || !Number.isFinite(n)) return n;
  return Number(n.toPrecision(digits));
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function formatUsd(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}
