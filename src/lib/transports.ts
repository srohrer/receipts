import type { Stage } from "./dsl";
import { PipelineError, type Transport } from "./pipeline";
import { readNdjson, type StreamEvent } from "./stream";

export interface DemoRecording {
  datasetId: string;
  question: string;
  /** "scripted" = hand-written walkthrough; "recorded" = captured from a live model run */
  source: "scripted" | "recorded";
  model?: string;
  recordedAt?: string;
  outputs: Partial<Record<Stage, string>>;
}

export function liveTransport(apiKey: string | undefined): Transport {
  return async (stage, input, correction, onEvent, signal) => {
    const started = performance.now();
    const res = await fetch("/api/analyze", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", ...(apiKey ? { "x-deepseek-key": apiKey } : {}) },
      body: JSON.stringify({ stage, input, correction }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as Extract<StreamEvent, { t: "error" }> | null;
      throw new PipelineError(err?.message ?? `Request failed (${res.status}).`);
    }
    let text = "";
    let done: Extract<StreamEvent, { t: "done" }> | undefined;
    for await (const e of readNdjson(res)) {
      if (e.t === "error") throw new PipelineError(e.message);
      if (e.t === "delta") text += e.text;
      if (e.t === "done") done = e;
      onEvent(e);
    }
    return { text, usage: done?.usage, model: done?.model, ms: done?.ms ?? performance.now() - started };
  };
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

/** Replays a saved run, streaming it at a readable pace so the UI behaves like a live call. */
export function replayTransport(rec: DemoRecording): Transport {
  return async (stage, _input, _correction, onEvent, signal) => {
    const text = rec.outputs[stage];
    if (!text) throw new PipelineError(`This demo has no recorded ${stage} step.`);
    const started = performance.now();
    await sleep(350, signal);
    const chunk = Math.max(24, Math.ceil(text.length / 45));
    for (let i = 0; i < text.length; i += chunk) {
      onEvent({ t: "delta", text: text.slice(i, i + chunk) });
      await sleep(22, signal);
    }
    return { text, ms: performance.now() - started, model: rec.model ? `${rec.model} (replay)` : "replay" };
  };
}
