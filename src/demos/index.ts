import type { DemoRecording } from "@/lib/transports";
import recorded from "./recorded.json";
import { SCRIPTED } from "./scripted";

/** Live recordings take precedence over scripted walkthroughs for the same question. */
const live = recorded as DemoRecording[];
export const DEMOS: DemoRecording[] = [
  ...live,
  ...SCRIPTED.filter((s) => !live.some((r) => r.datasetId === s.datasetId && r.question === s.question)),
];
