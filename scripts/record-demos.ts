/**
 * Runs every suggested sample question through the real pipeline against DeepSeek and
 * saves the accepted model outputs to src/demos/recorded.json. Recorded runs replace
 * the scripted walkthroughs, so the demo mode replays genuine model behavior.
 *
 *   DEEPSEEK_API_KEY=sk-... npm run record:demos      (or put the key in .env.local)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsvText } from "../src/lib/csv";
import type { Stage } from "../src/lib/dsl";
import { emptySteps, runAnalysis, type Analysis, type Transport } from "../src/lib/pipeline";
import {
  buildNarrateMessages,
  buildPlanMessages,
  buildRepairMessages,
  correctionMessages,
  type NarrateInput,
  type PlanInput,
  type RepairInput,
} from "../src/lib/prompts";
import { SAMPLES } from "../src/lib/samples";
import type { DemoRecording } from "../src/lib/transports";

const envFile = join(process.cwd(), ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const KEY = process.env.DEEPSEEK_API_KEY;
const BASE = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
const MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-flash";
if (!KEY) {
  console.error("Set DEEPSEEK_API_KEY (env or .env.local).");
  process.exit(1);
}

function transport(captured: Partial<Record<Stage, string>>): Transport {
  return async (stage, input, correction) => {
    const messages =
      stage === "plan"
        ? buildPlanMessages(input as PlanInput)
        : stage === "narrate"
          ? buildNarrateMessages(input as NarrateInput)
          : buildRepairMessages(input as RepairInput);
    if (correction) messages.push(...correctionMessages(correction.previous, correction.error));
    const started = Date.now();
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages,
        response_format: { type: "json_object" },
        thinking: { type: process.env.DEEPSEEK_THINKING === "enabled" ? "enabled" : "disabled" },
        temperature: 0.2,
        max_tokens: 8192,
      }),
    });
    if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${await res.text()}`);
    const json = await res.json();
    const text: string = json.choices[0].message.content ?? "";
    captured[stage] = text; // the last attempt is the accepted one
    return {
      text,
      model: json.model,
      ms: Date.now() - started,
      usage: {
        promptTokens: json.usage?.prompt_tokens ?? 0,
        completionTokens: json.usage?.completion_tokens ?? 0,
        cachedTokens: json.usage?.prompt_cache_hit_tokens ?? 0,
      },
    };
  };
}

async function main() {
  const out: DemoRecording[] = [];
  for (const sample of SAMPLES) {
    const csv = readFileSync(join(process.cwd(), "public", sample.file), "utf8");
    const dataset = parseCsvText(csv, { id: sample.id, name: sample.name, source: "sample" });
    for (const question of sample.questions) {
      const captured: Partial<Record<Stage, string>> = {};
      let a: Analysis = {
        id: "rec",
        question,
        datasetId: sample.id,
        createdAt: Date.now(),
        mode: "live",
        status: "running",
        steps: emptySteps(),
      };
      process.stdout.write(`${sample.id}: ${question} … `);
      await runAnalysis({
        dataset,
        question,
        history: [],
        transport: transport(captured),
        signal: new AbortController().signal,
        update: (fn) => (a = fn(a)),
      });
      if (a.status !== "done") {
        console.log(`failed (${a.error})`);
        continue;
      }
      const draft = Object.values(a.draft!.verdicts);
      const final = Object.values(a.verdicts!);
      console.log(
        `draft ${draft.filter((v) => v.status === "verified").length}/${draft.length}, ` +
          `final ${final.filter((v) => v.status === "verified").length}/${final.length}`,
      );
      if (a.steps.repair.status === "skipped") delete captured.repair;
      out.push({
        datasetId: sample.id,
        question,
        source: "recorded",
        model: a.steps.narrate.model ?? MODEL,
        recordedAt: new Date().toISOString(),
        outputs: captured,
      });
    }
  }
  writeFileSync(join(process.cwd(), "src/demos/recorded.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(`\nSaved ${out.length} recordings to src/demos/recorded.json`);
}

main();
