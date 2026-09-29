/**
 * Plan → Execute → Narrate → Verify → (Repair → Re-verify)
 *
 * Runs in the browser: the dataset never leaves the user's machine, only its schema,
 * a few sample rows and small aggregated results are sent to the model.
 */
import {
  extractJson,
  formatZodError,
  NarrativeSchema,
  PlanSchema,
  type Narrative,
  type Plan,
  type Stage,
} from "./dsl";
import { executePlan, QueryError, type QueryResult } from "./engine";
import { summarize } from "./csv";
import { serializeResults, type NarrateInput, type PlanInput, type RepairInput } from "./prompts";
import type { StreamEvent, Usage } from "./stream";
import type { Dataset } from "./types";
import { verifyAll, type Verdict } from "./verify";

export type StepName = "plan" | "execute" | "narrate" | "verify" | "repair";
export const STEPS: StepName[] = ["plan", "execute", "narrate", "verify", "repair"];

export interface StepState {
  status: "pending" | "running" | "done" | "error" | "skipped";
  startedAt?: number;
  ms?: number;
  usage?: Usage;
  model?: string;
  attempts: number;
  raw: string;
  reasoning: string;
  detail?: string;
}

export interface Analysis {
  id: string;
  question: string;
  datasetId: string;
  createdAt: number;
  mode: "live" | "replay";
  status: "running" | "done" | "error";
  steps: Record<StepName, StepState>;
  plan?: Plan;
  results?: Record<string, QueryResult>;
  /** the first narrative, before any repair */
  draft?: { narrative: Narrative; verdicts: Record<string, Verdict> };
  narrative?: Narrative;
  verdicts?: Record<string, Verdict>;
  error?: string;
  replaySource?: string;
}

export interface TransportResult {
  text: string;
  usage?: Usage;
  model?: string;
  ms: number;
}

export type Transport = (
  stage: Stage,
  input: PlanInput | NarrateInput | RepairInput,
  correction: { previous: string; error: string } | undefined,
  onEvent: (e: StreamEvent) => void,
  signal: AbortSignal,
) => Promise<TransportResult>;

export class PipelineError extends Error {}

export function emptySteps(): Record<StepName, StepState> {
  return Object.fromEntries(STEPS.map((s) => [s, { status: "pending", attempts: 0, raw: "", reasoning: "" }])) as Record<
    StepName,
    StepState
  >;
}

const MAX_ATTEMPTS = 3;

type Update = (fn: (a: Analysis) => Analysis) => void;

function patchStep(update: Update, step: StepName, patch: Partial<StepState> | ((s: StepState) => Partial<StepState>)) {
  update((a) => {
    const prev = a.steps[step];
    const next = typeof patch === "function" ? patch(prev) : patch;
    return { ...a, steps: { ...a.steps, [step]: { ...prev, ...next } } };
  });
}

const addUsage = (a: Usage | undefined, b: Usage | undefined): Usage | undefined =>
  !b ? a : !a ? b : { promptTokens: a.promptTokens + b.promptTokens, completionTokens: a.completionTokens + b.completionTokens, cachedTokens: a.cachedTokens + b.cachedTokens };

/**
 * Calls one model stage with validation-driven retries: if the output isn't valid JSON,
 * doesn't match the schema, or fails downstream (e.g. a query references a missing
 * column), the error is sent back to the model as a correction.
 */
async function runModelStep<T>(
  step: StepName,
  stage: Stage,
  input: PlanInput | NarrateInput | RepairInput,
  accept: (text: string) => T,
  transport: Transport,
  update: Update,
  signal: AbortSignal,
): Promise<T> {
  const started = performance.now();
  patchStep(update, step, { status: "running", startedAt: Date.now(), raw: "", reasoning: "" });
  let correction: { previous: string; error: string } | undefined;
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    patchStep(update, step, (s) => ({
      attempts: attempt,
      raw: attempt > 1 ? `${s.raw}\n\n── retry ${attempt} · ${lastError.split("\n")[0]} ──\n\n` : "",
    }));
    const res = await transport(
      stage,
      input,
      correction,
      (e) => {
        if (e.t === "delta") patchStep(update, step, (s) => ({ raw: s.raw + e.text }));
        else if (e.t === "reasoning") patchStep(update, step, (s) => ({ reasoning: s.reasoning + e.text }));
      },
      signal,
    );
    patchStep(update, step, (s) => ({ usage: addUsage(s.usage, res.usage), model: res.model ?? s.model }));
    try {
      const value = accept(res.text);
      patchStep(update, step, { status: "done", ms: performance.now() - started });
      return value;
    } catch (e) {
      lastError =
        e instanceof Error && "issues" in e ? formatZodError(e as never) : e instanceof Error ? e.message : String(e);
      correction = { previous: res.text, error: lastError };
    }
  }
  patchStep(update, step, { status: "error", ms: performance.now() - started, detail: lastError });
  throw new PipelineError(`The model couldn't produce a valid ${stage} after ${MAX_ATTEMPTS} attempts: ${lastError}`);
}

function validateChart(plan: Plan, results: Record<string, QueryResult>) {
  const c = plan.chart;
  if (!c) return;
  const r = results[c.query];
  if (!r) throw new Error(`chart.query "${c.query}" is not one of the query ids.`);
  const names = new Set(r.columns.map((col) => col.name));
  for (const col of [c.x, ...c.y, ...(c.series ? [c.series] : [])]) {
    if (!names.has(col)) {
      throw new Error(`chart references column "${col}", but query "${r.id}" returns: ${[...names].join(", ")}.`);
    }
  }
}

function validateNarrative(n: Narrative) {
  const ids = new Set(n.claims.map((c) => c.id));
  const markers = [...n.body.matchAll(/\[\[([^|\]]+)\|/g)].map((m) => m[1].trim());
  const missing = markers.filter((m) => !ids.has(m));
  if (missing.length) throw new Error(`body has claim markers with no matching claim: ${missing.join(", ")}.`);
}

export async function runAnalysis(opts: {
  dataset: Dataset;
  question: string;
  history: { question: string; headline: string }[];
  transport: Transport;
  update: Update;
  signal: AbortSignal;
}) {
  const { dataset, question, history, transport, update, signal } = opts;
  const summary = summarize(dataset);
  const base: PlanInput = { question, summary, history };

  try {
    // 1-2. Plan, and execute as part of acceptance so query errors feed back to the model.
    let results: Record<string, QueryResult> = {};
    let execMs = 0;
    const plan = await runModelStep(
      "plan",
      "plan",
      base,
      (text) => {
        const parsed = PlanSchema.parse(extractJson(text));
        const t0 = performance.now();
        try {
          results = executePlan(dataset, parsed.queries);
        } catch (e) {
          if (e instanceof QueryError) throw new Error(e.message);
          throw e;
        }
        validateChart(parsed, results);
        execMs = performance.now() - t0;
        return parsed;
      },
      transport,
      update,
      signal,
    );
    update((a) => ({ ...a, plan, results }));
    const rowsOut = Object.values(results).reduce((n, r) => n + r.rows.length, 0);
    patchStep(update, "execute", {
      status: "done",
      ms: execMs,
      detail: `${Object.keys(results).length} queries · ${dataset.rows.length.toLocaleString()} rows scanned · ${rowsOut} result rows`,
    });

    // 3. Narrate
    const narrateInput: NarrateInput = { ...base, plan, results: serializeResults(results) };
    const narrative = await runModelStep(
      "narrate",
      "narrate",
      narrateInput,
      (text) => {
        const n = NarrativeSchema.parse(extractJson(text));
        validateNarrative(n);
        return n;
      },
      transport,
      update,
      signal,
    );

    // 4. Verify
    const t0 = performance.now();
    const verdicts = verifyAll(narrative.claims, results);
    const failures = Object.values(verdicts).filter((v) => v.status !== "verified");
    patchStep(update, "verify", {
      status: "done",
      ms: performance.now() - t0,
      detail: `${narrative.claims.length - failures.length}/${narrative.claims.length} claims verified`,
    });
    update((a) => ({ ...a, draft: { narrative, verdicts }, narrative, verdicts }));

    // 5. Repair, only when something failed
    if (!failures.length) {
      patchStep(update, "repair", { status: "skipped", detail: "nothing to repair" });
    } else {
      const repaired = await runModelStep(
        "repair",
        "repair",
        { ...narrateInput, narrative, failures } satisfies RepairInput,
        (text) => {
          const n = NarrativeSchema.parse(extractJson(text));
          validateNarrative(n);
          return n;
        },
        transport,
        update,
        signal,
      );
      const reverdicts = verifyAll(repaired.claims, results);
      const stillFailing = Object.values(reverdicts).filter((v) => v.status !== "verified").length;
      patchStep(update, "repair", {
        detail: `${failures.length} failed → ${stillFailing} after revision`,
      });
      update((a) => ({ ...a, narrative: repaired, verdicts: reverdicts }));
    }

    update((a) => ({ ...a, status: "done" }));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (signal.aborted) {
      update((a) => ({ ...a, status: "error", error: "Cancelled." }));
      return;
    }
    update((a) => ({
      ...a,
      status: "error",
      error: message,
      steps: Object.fromEntries(
        Object.entries(a.steps).map(([k, s]) => [k, s.status === "running" ? { ...s, status: "error" } : s]),
      ) as Analysis["steps"],
    }));
  }
}
