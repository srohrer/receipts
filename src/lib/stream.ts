/** NDJSON events streamed from /api/analyze to the browser. */
export interface Usage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
}

export type StreamEvent =
  | { t: "delta"; text: string }
  | { t: "reasoning"; text: string }
  | { t: "done"; usage: Usage; model: string; ms: number }
  | { t: "error"; message: string; code?: "rate_limited" | "no_key" | "upstream" | "bad_request" };

/** deepseek-flash list prices (peak, USD per 1M tokens) — used for the cost readout. */
export const PRICING = { input: 0.3, cachedInput: 0.006, output: 1.2 };

export function estimateCost(u: Usage): number {
  const uncached = Math.max(0, u.promptTokens - u.cachedTokens);
  return (uncached * PRICING.input + u.cachedTokens * PRICING.cachedInput + u.completionTokens * PRICING.output) / 1e6;
}

export async function* readNdjson(res: Response): AsyncGenerator<StreamEvent> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) yield JSON.parse(line) as StreamEvent;
    }
  }
  if (buf.trim()) yield JSON.parse(buf) as StreamEvent;
}
