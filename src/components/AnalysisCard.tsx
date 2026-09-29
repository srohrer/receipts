"use client";

import clsx from "clsx";
import { AlertTriangle, RotateCcw, Square, Trash2, Wrench } from "lucide-react";
import { useState } from "react";
import type { Analysis, StepName } from "@/lib/pipeline";
import { useStore } from "@/lib/store";
import { score } from "@/lib/verify";
import { ChartView } from "./ChartView";
import { ModelOutputPanel } from "./ModelOutputPanel";
import { NarrativeView } from "./Narrative";
import { PipelineTimeline } from "./PipelineTimeline";
import { QueriesPanel } from "./QueriesPanel";
import { ReceiptsPanel } from "./ReceiptsPanel";
import { Button, Tabs } from "./ui";

type Panel = "receipts" | "queries" | "model";

function ScoreBadge({ verdicts }: { verdicts: NonNullable<Analysis["verdicts"]> }) {
  const s = score(verdicts);
  const clean = s.verified === s.total;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] font-medium",
        clean ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad",
      )}
    >
      {s.verified}/{s.total} claims verified
    </span>
  );
}

export function AnalysisCard({ analysis }: { analysis: Analysis }) {
  const ask = useStore((s) => s.ask);
  const cancel = useStore((s) => s.cancel);
  const remove = useStore((s) => s.remove);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [modelStep, setModelStep] = useState<StepName | undefined>();
  const [hovered, setHovered] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [showDraft, setShowDraft] = useState(false);

  const { plan, results, narrative, verdicts, draft } = analysis;
  const repaired = Boolean(draft && narrative && draft.narrative !== narrative);
  const viewing = showDraft && draft ? draft : narrative && verdicts ? { narrative, verdicts } : undefined;
  const evidence = hovered ? viewing?.verdicts[hovered]?.evidence : undefined;
  const running = analysis.status === "running";
  const activePanel: Panel = panel ?? (viewing ? "receipts" : "model");
  const draftScore = draft ? score(draft.verdicts) : null;
  const chartResult = plan?.chart && results?.[plan.chart.query];

  return (
    <article className="rounded-2xl border border-border bg-panel shadow-sm">
      <header className="flex items-start gap-3 border-b border-border px-5 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium">{analysis.question}</p>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-faint">
            {analysis.mode === "live" ? (
              <span>Live</span>
            ) : (
              <span className="rounded bg-warn-soft px-1.5 py-px text-warn">
                Replay · {analysis.replaySource === "recorded" ? "recorded run" : "scripted walkthrough"}
              </span>
            )}
            <span>{new Date(analysis.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          {running ? (
            <Button size="sm" variant="ghost" onClick={() => cancel(analysis.id)} aria-label="Stop">
              <Square className="size-3" /> Stop
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => ask(analysis.question)} aria-label="Run again">
              <RotateCcw className="size-3" />
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => remove(analysis.id)} aria-label="Remove">
            <Trash2 className="size-3" />
          </Button>
        </div>
      </header>

      <div className="border-b border-border px-5 py-3">
        <PipelineTimeline
          analysis={analysis}
          onSelect={(s) => {
            if (s === "execute") setPanel("queries");
            else if (s === "verify") setPanel("receipts");
            else {
              setModelStep(s);
              setPanel("model");
            }
          }}
        />
      </div>

      {analysis.error && (
        <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-xs text-bad">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span className="break-words">{analysis.error}</span>
        </div>
      )}

      <div className="grid gap-6 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="min-w-0">
          {plan?.chart && chartResult ? (
            <ChartView spec={plan.chart} result={chartResult} evidence={evidence} results={results} />
          ) : running && !plan ? (
            <div className="shimmer h-[300px] rounded-xl border border-border" />
          ) : plan ? (
            <div className="flex h-full min-h-32 items-center justify-center rounded-xl border border-dashed border-border text-xs text-faint">
              No chart for this question
            </div>
          ) : null}
        </div>

        <div className="min-w-0">
          {viewing ? (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <ScoreBadge verdicts={viewing.verdicts} />
                {repaired && draftScore && (
                  <div className="inline-flex overflow-hidden rounded-full border border-border text-[11px]">
                    <button
                      onClick={() => setShowDraft(false)}
                      className={clsx("px-2.5 py-1", !showDraft ? "bg-panel-2 text-text" : "text-muted")}
                    >
                      Repaired
                    </button>
                    <button
                      onClick={() => setShowDraft(true)}
                      className={clsx("px-2.5 py-1", showDraft ? "bg-panel-2 text-text" : "text-muted")}
                    >
                      Draft · {draftScore.total - draftScore.verified} failed
                    </button>
                  </div>
                )}
                {repaired && !showDraft && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted">
                    <Wrench className="size-3" /> self-corrected after verification
                  </span>
                )}
              </div>
              <NarrativeView
                narrative={viewing.narrative}
                verdicts={viewing.verdicts}
                activeClaim={hovered}
                onHoverClaim={setHovered}
                onSelectClaim={(id) => {
                  setPanel("receipts");
                  setFocus(null);
                  requestAnimationFrame(() => setFocus(id));
                }}
                draft={showDraft}
              />
            </>
          ) : running ? (
            <div className="space-y-3">
              <div className="shimmer h-6 w-3/4 rounded" />
              <div className="shimmer h-4 w-full rounded" />
              <div className="shimmer h-4 w-5/6 rounded" />
              <div className="shimmer h-4 w-2/3 rounded" />
            </div>
          ) : null}
        </div>
      </div>

      {(plan || analysis.steps.plan.raw) && (
        <div className="border-t border-border">
          <Tabs<Panel>
            className="px-3"
            value={activePanel}
            onChange={setPanel}
            items={[
              ...(viewing ? [{ value: "receipts" as const, label: `Receipts (${viewing.narrative.claims.length})` }] : []),
              ...(plan && results ? [{ value: "queries" as const, label: `Queries (${plan.queries.length})` }] : []),
              { value: "model", label: "Model output" },
            ]}
          />
          <div className="max-h-[560px] overflow-y-auto">
            {activePanel === "receipts" && viewing && (
              <ReceiptsPanel
                claims={viewing.narrative.claims}
                verdicts={viewing.verdicts}
                previous={!showDraft && repaired ? draft?.verdicts : undefined}
                activeClaim={hovered}
                focusClaim={focus}
                onHoverClaim={setHovered}
              />
            )}
            {activePanel === "queries" && plan && results && (
              <QueriesPanel plan={plan} results={results} evidence={evidence} />
            )}
            {activePanel === "model" && <ModelOutputPanel analysis={analysis} initial={modelStep} />}
          </div>
        </div>
      )}
    </article>
  );
}
