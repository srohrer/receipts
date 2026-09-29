/**
 * The contract between the model and the app.
 *
 * The model never computes numbers itself. It writes a *plan* (queries in a small
 * declarative DSL plus a chart spec), the app executes it deterministically, and then
 * the model writes a *narrative* whose factual claims are each paired with a machine-
 * checkable assertion. Every assertion is re-derived from the full data by verify.ts.
 */
import { z } from "zod";

const Scalar = z.union([z.string(), z.number(), z.boolean()]);

export const DATE_BUCKETS = ["year", "quarter", "month", "week", "day", "weekday", "daytype", "hour"] as const;

export const FilterSchema = z.object({
  column: z.string(),
  /** compare a date part instead of the raw value, e.g. weekday in ["Sat","Sun"] */
  bucket: z.enum(DATE_BUCKETS).nullish(),
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "not_in", "contains", "between", "is_null", "not_null"]),
  value: z.union([Scalar, z.array(Scalar)]).nullish(),
});

export const GroupBySchema = z.union([
  z.string(),
  z.object({ column: z.string(), bucket: z.enum(DATE_BUCKETS), as: z.string().nullish() }),
]);

export const AGG_FNS = ["sum", "avg", "min", "max", "count", "count_distinct", "median"] as const;

export const AggregateSchema = z.object({
  fn: z.enum(AGG_FNS),
  column: z.string().nullish(),
  as: z.string(),
});

export const ComputedSchema = z.object({
  as: z.string(),
  op: z.enum(["add", "sub", "mul", "div", "pct_of_total", "pct_change_prev"]),
  left: z.union([z.string(), z.number()]),
  right: z.union([z.string(), z.number()]).nullish(),
});

export const QuerySchema = z.object({
  id: z.string(),
  title: z.string(),
  filters: z.array(FilterSchema).nullish(),
  groupBy: z.array(GroupBySchema).nullish(),
  aggregates: z.array(AggregateSchema).nullish(),
  computed: z.array(ComputedSchema).nullish(),
  select: z.array(z.string()).nullish(),
  sort: z.array(z.object({ by: z.string(), dir: z.enum(["asc", "desc"]).nullish() })).nullish(),
  limit: z.number().int().positive().nullish(),
});

export const ChartSchema = z.object({
  type: z.enum(["bar", "line", "area", "scatter", "pie"]),
  query: z.string(),
  x: z.string(),
  y: z.array(z.string()).min(1).max(6),
  series: z.string().nullish(),
  stacked: z.boolean().nullish(),
  horizontal: z.boolean().nullish(),
  title: z.string(),
  yFormat: z.enum(["number", "currency", "percent"]).nullish(),
});

export const PlanSchema = z.object({
  intent: z.string(),
  assumptions: z.array(z.string()).nullish(),
  queries: z.array(QuerySchema).min(1).max(6),
  chart: ChartSchema.nullish(),
});

/** A pointer to one cell of a query result: query id + a row selector + a field. */
export const RefSchema = z.object({
  query: z.string(),
  where: z.record(z.string(), Scalar).nullish(),
  field: z.string(),
});

export const CheckSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("value"), ref: RefSchema, expected: z.number() }),
  z.object({ type: z.literal("compare"), left: RefSchema, right: RefSchema, op: z.enum(["gt", "lt", "eq"]) }),
  z.object({ type: z.literal("pct_change"), from: RefSchema, to: RefSchema, expected: z.number() }),
  z.object({ type: z.literal("ratio"), numerator: RefSchema, denominator: RefSchema, expected: z.number() }),
  z.object({ type: z.literal("share"), ref: RefSchema, expected: z.number() }),
  z.object({
    type: z.literal("rank"),
    ref: RefSchema,
    rank: z.number().int().positive(),
    order: z.enum(["desc", "asc"]).nullish(),
  }),
  z.object({
    type: z.literal("trend"),
    query: z.string(),
    x: z.string(),
    field: z.string(),
    direction: z.enum(["up", "down", "flat"]),
  }),
  z.object({
    type: z.literal("count"),
    query: z.string(),
    where: z.record(z.string(), Scalar).nullish(),
    expected: z.number(),
  }),
]);

export const ClaimSchema = z.object({
  id: z.string(),
  statement: z.string(),
  check: CheckSchema,
});

export const NarrativeSchema = z.object({
  headline: z.string(),
  /** Prose with inline claim markers: "Revenue grew [[c1|14% year over year]]." */
  body: z.string(),
  claims: z.array(ClaimSchema).max(16),
  caveats: z.array(z.string()).nullish(),
});

export type Filter = z.infer<typeof FilterSchema>;
export type GroupBy = z.infer<typeof GroupBySchema>;
export type Aggregate = z.infer<typeof AggregateSchema>;
export type Computed = z.infer<typeof ComputedSchema>;
export type Query = z.infer<typeof QuerySchema>;
export type ChartSpec = z.infer<typeof ChartSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type Ref = z.infer<typeof RefSchema>;
export type Check = z.infer<typeof CheckSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type Narrative = z.infer<typeof NarrativeSchema>;

export type Stage = "plan" | "narrate" | "repair";

export function formatZodError(err: z.ZodError): string {
  return z.prettifyError(err);
}

/** Pulls a JSON object out of model output, tolerating code fences and stray prose. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Model output contained no JSON object.");
  return JSON.parse(candidate.slice(start, end + 1));
}
