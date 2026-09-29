import { z } from "zod";
import {
  buildNarrateMessages,
  buildPlanMessages,
  buildRepairMessages,
  correctionMessages,
  type NarrateInput,
  type PlanInput,
  type RepairInput,
} from "@/lib/prompts";
import { streamCompletion } from "@/lib/server/deepseek";
import { checkRateLimit } from "@/lib/server/ratelimit";
import type { StreamEvent } from "@/lib/stream";

export const maxDuration = 60;

const MAX_BODY_BYTES = 400_000;

// The heavy structures (summary, plan, results) are only interpolated into the prompt,
// so we validate their envelope and size rather than re-validating every field.
const Body = z.object({
  stage: z.enum(["plan", "narrate", "repair"]),
  input: z
    .object({
      question: z.string().min(1).max(600),
      summary: z.object({ name: z.string(), rowCount: z.number(), columns: z.array(z.any()), sampleRows: z.array(z.any()) }),
      history: z.array(z.object({ question: z.string(), headline: z.string() })).max(8).optional(),
      plan: z.any().optional(),
      results: z.array(z.any()).optional(),
      narrative: z.any().optional(),
      failures: z.array(z.any()).optional(),
    })
    .loose(),
  correction: z.object({ previous: z.string().max(60_000), error: z.string().max(8_000) }).optional(),
});

function ndjson(events: AsyncIterable<StreamEvent>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const e of events) controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        controller.enqueue(encoder.encode(JSON.stringify({ t: "error", code: "upstream", message }) + "\n"));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}

const fail = (status: number, code: Extract<StreamEvent, { t: "error" }>["code"], message: string) =>
  Response.json({ t: "error", code, message } satisfies StreamEvent, { status });

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return fail(413, "bad_request", "Request too large.");

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(JSON.parse(raw));
  } catch (e) {
    return fail(400, "bad_request", e instanceof z.ZodError ? z.prettifyError(e) : "Invalid JSON body.");
  }

  const userKey = req.headers.get("x-deepseek-key")?.trim();
  const apiKey = userKey || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return fail(401, "no_key", "No DeepSeek API key is configured. Add your own key in Settings.");

  if (!userKey) {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
    const limit = await checkRateLimit(ip);
    if (!limit.ok) return fail(429, "rate_limited", limit.reason);
  }

  const messages =
    body.stage === "plan"
      ? buildPlanMessages(body.input as PlanInput)
      : body.stage === "narrate"
        ? buildNarrateMessages(body.input as NarrateInput)
        : buildRepairMessages(body.input as RepairInput);
  if (body.correction) messages.push(...correctionMessages(body.correction.previous, body.correction.error));

  return ndjson(streamCompletion(messages, apiKey, req.signal));
}
