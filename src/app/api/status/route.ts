import { connection } from "next/server";
import { MODEL } from "@/lib/server/deepseek";

export async function GET() {
  await connection(); // read env at request time, not build time
  return Response.json({ sharedKey: Boolean(process.env.DEEPSEEK_API_KEY), model: MODEL });
}
