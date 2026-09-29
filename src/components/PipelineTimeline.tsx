"use client";

import clsx from "clsx";
import { Check, CircleSlash, Cpu, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { formatMs, formatUsd } from "@/lib/format";
import { STEPS, type Analysis, type StepName } from "@/lib/pipeline";
import { estimateCost } from "@/lib/stream";
import { Spinner } from "./ui";

const META: Record<StepName, { label: string; llm: boolean }> = {
  plan: { label: "Plan", llm: true },
  execute: { label: "Execute", llm: false },
  narrate: { label: "Narrate", llm: true },
  verify: { label: "Verify", llm: false },
  repair: { label: "Repair", llm: true },
};

/** Current time, refreshed every 100ms while `active` (drives the live step timers). */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function PipelineTimeline({ analysis, onSelect }: { analysis: Analysis; onSelect?: (s: StepName) => void }) {
  const running = STEPS.some((s) => analysis.steps[s].status === "running");
  const now = useNow(running);

  const usage = STEPS.map((s) => analysis.steps[s].usage).filter(Boolean);
  const tokens = usage.reduce((n, u) => n + u!.promptTokens + u!.completionTokens, 0);
  const cost = usage.reduce((n, u) => n + estimateCost(u!), 0);

  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-2 text-[11px]">
      {STEPS.map((name, i) => {
        const s = analysis.steps[name];
        const meta = META[name];
        const elapsed = s.status === "running" && s.startedAt ? Math.max(0, now - s.startedAt) : s.ms;
        return (
          <div key={name} className="flex items-center gap-1">
            {i > 0 && <div className={clsx("h-px w-3", s.status === "pending" ? "bg-border" : "bg-faint")} />}
            <button
              onClick={() => onSelect?.(name)}
              title={s.detail}
              className={clsx(
                "relative flex items-center gap-1.5 overflow-hidden rounded-full border px-2.5 py-1 transition-colors",
                s.status === "running" && "border-brand/50 text-text",
                s.status === "done" && "border-border text-text hover:bg-panel-2",
                s.status === "error" && "border-bad/50 text-bad",
                (s.status === "pending" || s.status === "skipped") && "border-border/60 text-faint",
              )}
            >
              {s.status === "running" && <span className="shimmer absolute inset-0" />}
              <span className="relative flex items-center gap-1.5">
                {s.status === "running" ? (
                  <Spinner className="size-3 text-brand" />
                ) : s.status === "done" ? (
                  <Check className="size-3 text-ok" strokeWidth={3} />
                ) : s.status === "error" ? (
                  <X className="size-3" strokeWidth={3} />
                ) : s.status === "skipped" ? (
                  <CircleSlash className="size-3" />
                ) : meta.llm ? (
                  <Sparkles className="size-3" />
                ) : (
                  <Cpu className="size-3" />
                )}
                <span className="font-medium">{meta.label}</span>
                {meta.llm ? (
                  <Sparkles className="size-2.5 text-brand/70" aria-label="model call" />
                ) : (
                  <Cpu className="size-2.5 text-faint" aria-label="deterministic" />
                )}
                {elapsed !== undefined && s.status !== "skipped" && (
                  <span className="font-mono text-faint tabular-nums">{formatMs(elapsed)}</span>
                )}
                {s.attempts > 1 && <span className="rounded bg-warn-soft px-1 text-warn">×{s.attempts}</span>}
              </span>
            </button>
          </div>
        );
      })}
      {tokens > 0 && (
        <span className="ml-auto pl-2 font-mono text-faint tabular-nums">
          {tokens.toLocaleString()} tok · {formatUsd(cost)}
        </span>
      )}
    </div>
  );
}
