import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SCRIPTED } from "@/demos/scripted";
import { parseCsvText } from "../csv";
import { runAnalysis, emptySteps, type Analysis } from "../pipeline";
import { replayTransport } from "../transports";

// Runs every scripted demo through the real pipeline (engine + verifier + repair).
describe("scripted demos", () => {
  for (const demo of SCRIPTED) {
    it(`${demo.datasetId}: ${demo.question}`, async () => {
      const text = readFileSync(join(process.cwd(), "public/samples", `${demo.datasetId}.csv`), "utf8");
      const dataset = parseCsvText(text, { id: demo.datasetId, name: demo.datasetId, source: "sample" });
      let a: Analysis = {
        id: "t", question: demo.question, datasetId: demo.datasetId, createdAt: 0, mode: "replay", status: "running", steps: emptySteps(),
      };
      await runAnalysis({
        dataset, question: demo.question, history: [], transport: replayTransport(demo),
        signal: new AbortController().signal, update: (fn) => (a = fn(a)),
      });
      expect(a.error).toBeUndefined();
      expect(a.status).toBe("done");
      const final = Object.values(a.verdicts!);
      const failures = final.filter((v) => v.status !== "verified");
      expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
      const draft = Object.values(a.draft!.verdicts).map((v) => `${v.claimId}:${v.status}`);
      console.log(demo.datasetId, "draft:", draft.filter((d) => !d.endsWith("verified")).join(", ") || "all verified");
    }, 30_000);
  }
});
