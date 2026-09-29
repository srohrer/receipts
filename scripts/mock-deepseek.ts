/**
 * A tiny stand-in for DeepSeek's streaming chat API that answers the suggested sample
 * questions with the scripted demo outputs. Lets you exercise the full live path
 * (API route, SSE parsing, retries, repair) with no API key:
 *
 *   npm run mock:deepseek          # terminal 1
 *   npm run dev:mock               # terminal 2
 *
 * MOCK_FLAKY=1 makes the first plan reference a column that doesn't exist, so you
 * can watch the correction loop recover.
 */
import { createServer } from "node:http";
import { SCRIPTED } from "../src/demos/scripted";

const FLAKY = process.env.MOCK_FLAKY === "1";
createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  const { messages, model } = JSON.parse(body) as { messages: { role: string; content: string }[]; model: string };
  const sys: string = messages[0].content;
  const user: string = messages.map((m) => m.content).join("\n");
  const stage = sys.includes("revising a narrative") ? "repair" : sys.includes("planning stage") ? "plan" : "narrate";
  const demo = SCRIPTED.find((d) => user.includes(d.question));
  if (!demo) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "The mock only knows the suggested sample questions." }));
    return;
  }
  let text = demo.outputs[stage as "plan"]!;
  const isCorrection = messages.at(-1)!.content.includes("could not be used");
  if (FLAKY && stage === "plan" && !isCorrection) text = text.replace('"column": "', '"column": "not_a_column_');
  console.log(`[mock] ${stage}${isCorrection ? " (correction)" : ""} model=${model} msgs=${messages.length}`);
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  send({ model: "deepseek-flash-mock", choices: [{ delta: { reasoning_content: `Thinking about ${stage}…` } }] });
  for (let i = 0; i < text.length; i += 40) {
    send({ model: "deepseek-flash-mock", choices: [{ delta: { content: text.slice(i, i + 40) } }] });
    await new Promise((r) => setTimeout(r, 5));
  }
  send({ choices: [], usage: { prompt_tokens: 2000, completion_tokens: Math.round(text.length / 4), prompt_cache_hit_tokens: 1200 } });
  res.write("data: [DONE]\n\n");
  res.end();
}).listen(3999, () => console.log("mock on 3999"));
