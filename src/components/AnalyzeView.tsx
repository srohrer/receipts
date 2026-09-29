"use client";

import clsx from "clsx";
import { ArrowUp, Cpu, Play, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SAMPLES } from "@/lib/samples";
import { findDemo, useActiveDataset, useStore } from "@/lib/store";
import type { Dataset } from "@/lib/types";
import { AnalysisCard } from "./AnalysisCard";
import { Kbd } from "./ui";

function suggestionsFor(ds: Dataset): string[] {
  const sample = SAMPLES.find((s) => s.id === ds.id);
  if (sample) return sample.questions;
  const num = ds.columns.filter((c) => c.type === "number").map((c) => c.name);
  const cat = ds.columns.filter((c) => c.type === "category").map((c) => c.name);
  const date = ds.columns.find((c) => c.type === "date")?.name;
  const out: string[] = [];
  if (num[0] && cat[0]) out.push(`Which ${cat[0]} has the highest total ${num[0]}?`);
  if (num[0] && date) out.push(`How has ${num[0]} changed over time?`);
  if (num.length >= 2) out.push(`Is ${num[0]} related to ${num[1]}?`);
  if (!out.length) out.push("Summarize this dataset.");
  return out;
}

function HowItWorks() {
  const steps = [
    { icon: Sparkles, title: "Plan", body: "The model reads only the schema and a few sample rows, then writes queries in a small typed DSL." },
    { icon: Cpu, title: "Execute", body: "Queries run locally in your browser over every row. The model never does arithmetic." },
    { icon: Sparkles, title: "Narrate", body: "The model explains the results, and each factual claim comes with a machine-checkable assertion." },
    { icon: ShieldCheck, title: "Verify & repair", body: "Every claim is recomputed from the data. Failed claims go back to the model with the true values." },
  ];
  return (
    <div className="mx-auto max-w-3xl py-10">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-balance">Data analysis with receipts.</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted">
          Ask a question about a CSV. An LLM plans the analysis and explains it, and every number it states is
          independently re-derived from your data before you see it. Hover any underlined claim to see its proof.
        </p>
      </div>
      <ol className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.title} className="rounded-xl border border-border bg-panel p-4">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <span className="font-mono text-faint">{i + 1}</span>
              <s.icon className={clsx("size-3.5", s.icon === Cpu ? "text-faint" : s.icon === ShieldCheck ? "text-ok" : "text-brand")} />
              {s.title}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted">{s.body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function AnalyzeView() {
  const dataset = useActiveDataset();
  const all = useStore((s) => s.analyses);
  const ask = useStore((s) => s.ask);
  const apiKey = useStore((s) => s.apiKey);
  const server = useStore((s) => s.server);
  const [q, setQ] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const analyses = useMemo(() => all.filter((a) => a.datasetId === dataset?.id), [all, dataset?.id]);
  const busy = analyses.some((a) => a.status === "running");
  const live = Boolean(apiKey || server?.sharedKey);
  const suggestions = dataset ? suggestionsFor(dataset) : [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [analyses.length]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = `${Math.min(160, ta.scrollHeight)}px`;
  }, [q]);

  const submit = (text = q) => {
    if (!text.trim() || busy) return;
    ask(text);
    setQ("");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6">
          {analyses.length === 0 && <HowItWorks />}
          {analyses.map((a) => (
            <AnalysisCard key={a.id} analysis={a} />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-border bg-bg/80 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 pt-3 pb-4 sm:px-6">
          {dataset && (
            <div className={clsx("mb-2 flex gap-1.5", analyses.length ? "overflow-x-auto pb-1 [&>button]:shrink-0 [&>button]:whitespace-nowrap" : "flex-wrap")}>
              {suggestions.map((s) => {
                const demo = findDemo(dataset.id, s);
                return (
                  <button
                    key={s}
                    disabled={busy}
                    onClick={() => submit(s)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-panel px-3 py-1 text-xs text-muted transition-colors hover:border-faint hover:text-text disabled:opacity-50"
                  >
                    {!live && demo && <Play className="size-2.5 text-warn" />}
                    {s}
                    {!live && demo && <span className="text-[10px] text-warn">demo</span>}
                  </button>
                );
              })}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="flex items-end gap-2 rounded-xl border border-border bg-panel p-2 focus-within:border-brand/60"
          >
            <textarea
              ref={taRef}
              value={q}
              rows={1}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={dataset ? `Ask about ${dataset.name}…` : "Loading dataset…"}
              disabled={!dataset}
              maxLength={600}
              className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-faint"
            />
            <button
              type="submit"
              disabled={!q.trim() || busy || !dataset}
              aria-label="Ask"
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand text-white transition hover:brightness-110 disabled:opacity-40"
            >
              <ArrowUp className="size-4" />
            </button>
          </form>
          <div className="mt-1.5 flex justify-between px-1 text-[10px] text-faint">
            <span>
              {live ? "Live · DeepSeek" : "No API key. Suggested questions replay saved demo runs"} · only schema, samples &
              aggregates are sent to the model
            </span>
            <span className="hidden sm:inline">
              <Kbd>Enter</Kbd> to ask · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> newline
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
