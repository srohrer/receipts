"use client";

import { create } from "zustand";
import { DEMOS } from "@/demos";
import { parseCsvFile, parseCsvText } from "./csv";
import { emptySteps, runAnalysis, type Analysis } from "./pipeline";
import { SAMPLES } from "./samples";
import { liveTransport, replayTransport, type DemoRecording } from "./transports";
import type { Dataset } from "./types";

const KEY_STORAGE = "receipts:deepseek-key";

const safeStorage = {
  get(key: string): string {
    try {
      return localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  },
  set(key: string, value: string) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch {
      /* private mode etc. — the key just won't persist */
    }
  },
};

const normalize = (q: string) => q.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function findDemo(datasetId: string, question: string): DemoRecording | undefined {
  const n = normalize(question);
  return DEMOS.find((d) => d.datasetId === datasetId && normalize(d.question) === n);
}

interface State {
  datasets: Record<string, Dataset>;
  loading: Record<string, boolean>;
  activeDatasetId: string | null;
  analyses: Analysis[];
  view: "analyze" | "data";
  apiKey: string;
  server: { sharedKey: boolean; model: string } | null;
  error: string | null;

  init(): Promise<void>;
  selectSample(id: string): Promise<void>;
  upload(file: File): Promise<void>;
  setActive(id: string): void;
  setView(v: State["view"]): void;
  ask(question: string): void;
  cancel(id: string): void;
  remove(id: string): void;
  setApiKey(key: string): void;
  dismissError(): void;
}

const controllers = new Map<string, AbortController>();

export const useStore = create<State>((set, get) => ({
  datasets: {},
  loading: {},
  activeDatasetId: null,
  analyses: [],
  view: "analyze",
  apiKey: "",
  server: null,
  error: null,

  async init() {
    set({ apiKey: safeStorage.get(KEY_STORAGE) });
    fetch("/api/status")
      .then((r) => r.json())
      .then((server) => set({ server }))
      .catch(() => set({ server: { sharedKey: false, model: "deepseek-flash" } }));
    if (!get().activeDatasetId) await get().selectSample(SAMPLES[0].id);
  },

  async selectSample(id) {
    set({ activeDatasetId: id });
    if (get().datasets[id] || get().loading[id]) return;
    const meta = SAMPLES.find((s) => s.id === id);
    if (!meta) return;
    set((s) => ({ loading: { ...s.loading, [id]: true } }));
    try {
      const text = await fetch(meta.file).then((r) => r.text());
      const ds = parseCsvText(text, { id, name: meta.name, source: "sample", description: meta.description });
      set((s) => ({ datasets: { ...s.datasets, [id]: ds } }));
    } catch (e) {
      set({ error: `Couldn't load ${meta.name}: ${e instanceof Error ? e.message : e}` });
    } finally {
      set((s) => ({ loading: { ...s.loading, [id]: false } }));
    }
  },

  async upload(file) {
    if (file.size > 50 * 1024 * 1024) {
      set({ error: "That file is over 50 MB — try a smaller extract." });
      return;
    }
    try {
      const ds = await parseCsvFile(file);
      set((s) => ({ datasets: { ...s.datasets, [ds.id]: ds }, activeDatasetId: ds.id, view: "analyze" }));
    } catch (e) {
      set({ error: `Couldn't parse ${file.name}: ${e instanceof Error ? e.message : e}` });
    }
  },

  setActive: (id) => set({ activeDatasetId: id }),
  setView: (view) => set({ view }),

  ask(question) {
    const { activeDatasetId, datasets, apiKey, server, analyses } = get();
    const dataset = activeDatasetId ? datasets[activeDatasetId] : undefined;
    if (!dataset || !question.trim()) return;

    const liveAvailable = Boolean(apiKey || server?.sharedKey);
    const demo = findDemo(dataset.id, question);
    if (!liveAvailable && !demo) {
      set({
        error:
          "Live mode needs a DeepSeek API key. Add one in Settings, or pick a suggested question marked “demo” to replay a saved run.",
      });
      return;
    }

    const id = crypto.randomUUID();
    const mode = liveAvailable ? "live" : "replay";
    const analysis: Analysis = {
      id,
      question: question.trim(),
      datasetId: dataset.id,
      createdAt: Date.now(),
      mode,
      status: "running",
      steps: emptySteps(),
      replaySource: mode === "replay" ? demo!.source : undefined,
    };
    set({ analyses: [...analyses, analysis], view: "analyze" });

    const controller = new AbortController();
    controllers.set(id, controller);
    const history = analyses
      .filter((a) => a.datasetId === dataset.id && a.narrative)
      .slice(-4)
      .map((a) => ({ question: a.question, headline: a.narrative!.headline }));

    runAnalysis({
      dataset,
      question: analysis.question,
      history,
      transport: mode === "live" ? liveTransport(apiKey || undefined) : replayTransport(demo!),
      signal: controller.signal,
      update: (fn) => set((s) => ({ analyses: s.analyses.map((a) => (a.id === id ? fn(a) : a)) })),
    }).finally(() => controllers.delete(id));
  },

  cancel(id) {
    controllers.get(id)?.abort();
  },

  remove(id) {
    controllers.get(id)?.abort();
    set((s) => ({ analyses: s.analyses.filter((a) => a.id !== id) }));
  },

  setApiKey(key) {
    safeStorage.set(KEY_STORAGE, key.trim());
    set({ apiKey: key.trim() });
  },

  dismissError: () => set({ error: null }),
}));

export function useActiveDataset(): Dataset | undefined {
  return useStore((s) => (s.activeDatasetId ? s.datasets[s.activeDatasetId] : undefined));
}
