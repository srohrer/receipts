"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import type { Analysis, StepName } from "@/lib/pipeline";

const LLM_STEPS: StepName[] = ["plan", "narrate", "repair"];

export function ModelOutputPanel({ analysis, initial }: { analysis: Analysis; initial?: StepName }) {
  const available = LLM_STEPS.filter((s) => analysis.steps[s].raw || analysis.steps[s].status === "running");
  const [step, setStep] = useState<StepName>(initial && LLM_STEPS.includes(initial) ? initial : "plan");
  const current = available.includes(step) ? step : (available.at(-1) ?? "plan");
  const s = analysis.steps[current];
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (s.status === "running" && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [s.raw, s.status]);

  return (
    <div className="p-3">
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
        {available.map((name) => (
          <button
            key={name}
            onClick={() => setStep(name)}
            className={clsx(
              "rounded-md px-2 py-1 font-medium capitalize",
              current === name ? "bg-brand-soft text-brand" : "text-muted hover:bg-panel-2",
            )}
          >
            {name}
          </button>
        ))}
        <span className="ml-auto font-mono text-[11px] text-faint">
          {s.model ?? ""}
          {s.usage && ` · ${s.usage.promptTokens.toLocaleString()} in / ${s.usage.completionTokens.toLocaleString()} out`}
          {s.usage?.cachedTokens ? ` · ${s.usage.cachedTokens.toLocaleString()} cached` : ""}
        </span>
      </div>
      {s.reasoning && (
        <details className="mb-2 rounded-lg border border-border text-xs">
          <summary className="cursor-pointer px-3 py-2 text-muted">Reasoning ({s.reasoning.length.toLocaleString()} chars)</summary>
          <pre className="max-h-60 overflow-auto px-3 pb-3 font-mono text-[11px] whitespace-pre-wrap text-faint">{s.reasoning}</pre>
        </details>
      )}
      <pre
        ref={preRef}
        className="max-h-96 overflow-auto rounded-lg border border-border bg-panel-2/60 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted"
      >
        {s.raw || "…"}
        {s.status === "running" && <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-brand align-middle" />}
      </pre>
      {s.detail && s.status === "error" && <p className="mt-2 text-xs text-bad">{s.detail}</p>}
    </div>
  );
}
