import "server-only";
import type { ChatMessage } from "../prompts";
import type { StreamEvent, Usage } from "../stream";

const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
export const MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-flash";
const THINKING = process.env.DEEPSEEK_THINKING === "enabled" ? "enabled" : "disabled";

interface ChunkChoice {
  delta?: { content?: string | null; reasoning_content?: string | null };
}
interface Chunk {
  model?: string;
  choices?: ChunkChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number };
}

/**
 * Streams a JSON-mode chat completion from DeepSeek's OpenAI-compatible endpoint,
 * re-emitting it as our own NDJSON events.
 */
export async function* streamCompletion(
  messages: ChatMessage[],
  apiKey: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const started = Date.now();
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      response_format: { type: "json_object" },
      thinking: { type: THINKING },
      temperature: 0.2,
      max_tokens: 8192,
    }),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    yield {
      t: "error",
      code: res.status === 401 ? "no_key" : "upstream",
      message: res.status === 401 ? "DeepSeek rejected the API key." : `DeepSeek returned ${res.status}. ${detail.slice(0, 300)}`,
    };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let model = MODEL;
  const usage: Usage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0 };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let chunk: Chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (chunk.model) model = chunk.model;
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.reasoning_content) yield { t: "reasoning", text: delta.reasoning_content };
      if (delta?.content) yield { t: "delta", text: delta.content };
      if (chunk.usage) {
        usage.promptTokens = chunk.usage.prompt_tokens ?? 0;
        usage.completionTokens = chunk.usage.completion_tokens ?? 0;
        usage.cachedTokens = chunk.usage.prompt_cache_hit_tokens ?? 0;
      }
    }
  }
  yield { t: "done", usage, model, ms: Date.now() - started };
}
