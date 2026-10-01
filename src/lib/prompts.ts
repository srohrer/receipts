import type { Narrative, Plan } from "./dsl";
import type { QueryResult } from "./engine";
import { roundSig } from "./format";
import type { Verdict } from "./verify";
import type { DatasetSummary, Row } from "./types";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export const RESULT_ROWS_FOR_MODEL = 60;

const PLAN_SYSTEM = `You are the planning stage of a data-analysis tool. You never compute numbers yourself.
Given a dataset's schema, column profile and a few sample rows, you write a JSON plan: queries in a small declarative DSL that the app executes deterministically, plus at most one chart.

Respond with a single JSON object of this shape:
{
  "intent": "one sentence restating what the user wants to know",
  "assumptions": ["any interpretation you had to make, e.g. which column means revenue"],
  "queries": [ Query, ... ],          // 1-4 queries
  "chart": Chart | null
}

Query:
{
  "id": "snake_case_id",
  "title": "Human title",
  "filters": [{ "column": "...", "op": "eq|neq|gt|gte|lt|lte|in|not_in|contains|between|is_null|not_null", "value": scalar | [scalars], "bucket": "optional date part to compare instead of the raw date" }],
  "groupBy": ["category_column", { "column": "date_column", "bucket": "year|quarter|month|week|day|weekday|daytype|hour", "as": "optional_name" }],
  "aggregates": [{ "fn": "sum|avg|min|max|count|count_distinct|median", "column": "numeric_column (omit for count(*))", "as": "result_name" }],
  "computed": [{ "as": "name", "op": "add|sub|mul|div", "left": "result_column_or_number", "right": "result_column_or_number" },
               { "as": "name", "op": "pct_of_total|pct_change_prev", "left": "result_column" }],
  "select": ["columns, only for non-aggregated queries"],
  "sort": [{ "by": "result_column", "dir": "asc|desc" }],
  "limit": 20
}

Chart:
{ "type": "bar|line|area|scatter|pie", "query": "query_id", "x": "result_column", "y": ["numeric result columns"],
  "series": "optional result column to split into one series per value (long format)", "stacked": false,
  "horizontal": false, "title": "...", "yFormat": "number|currency|percent" }

Rules:
- Use column names exactly as given in the schema. Date columns hold ISO strings, so date filters can compare against "2024-06-01" or a prefix like "2024".
- Bucketed group columns are named "<column>_<bucket>" unless you set "as". Bucket values look like "2024", "2024-Q3", "2024-07", "2024-W05", "2024-07-15", "Mon" (weekday), "Weekend"/"Weekday" (daytype), "09" (hour). Filters accept the same buckets, e.g. { "column": "date", "bucket": "weekday", "op": "in", "value": ["Sat", "Sun"] }.
- To get a per-day (or per-entity) average of a total, aggregate the sum plus count_distinct of the date/entity, then divide with computed.
- computed columns are evaluated per result row after aggregation; pct_of_total gives a percent (0-100) of the column total; pct_change_prev gives percent change vs the previous row in sort order.
- Keep each result small (ideally <= 40 rows): aggregate, bucket, or use limit. Never return raw rows unless the question is about individual records.
- Don't put a limit on a query if the answer needs shares of the whole.
- Add a supporting query when the narrative will need a comparison the main query doesn't contain (e.g. a total, a previous period).
- Chart x must be a dimension column of the chart's query. Time series should use a line or area chart sorted by time.
- Output JSON only.`;

const NARRATE_SYSTEM = `You are the narration stage of a data-analysis tool. The app has executed your queries; you now explain the results.
Every factual statement you make will be independently re-computed from the data by a verifier. Claims that fail are shown to the user as contradicted, so be precise.

Respond with a single JSON object:
{
  "headline": "one short sentence answering the question",
  "body": "2-5 sentences of plain prose. Wrap every factual claim in a marker: [[c1|the claim text as displayed]].",
  "claims": [ { "id": "c1", "statement": "self-contained restatement", "check": Check } ],
  "caveats": ["limitations of the data or analysis, if any"]
}

Every number, ranking, comparison, superlative, or trend in the body MUST be a claim with a check. Checks point at cells of the query results using a Ref:
Ref = { "query": "query_id", "where": { "dimension_column": "exact value from the results" }, "field": "result_column" }
("where" selects exactly one row; omit it only when the query has one row.)

Check types:
- { "type": "value", "ref": Ref, "expected": 1234.5 }
- { "type": "pct_change", "from": Ref, "to": Ref, "expected": 14 }        // percent units: 14 means +14%, -8 means -8%
- { "type": "ratio", "numerator": Ref, "denominator": Ref, "expected": 2.3 } // "2.3x"
- { "type": "share", "ref": Ref, "expected": 41 }                          // percent of that field's total across the query's rows
- { "type": "rank", "ref": Ref, "rank": 1, "order": "desc" }               // 1 = largest when desc
- { "type": "compare", "left": Ref, "right": Ref, "op": "gt|lt|eq" }
- { "type": "trend", "query": "query_id", "x": "dimension_column", "field": "result_column", "direction": "up|down|flat" }
- { "type": "count", "query": "query_id", "where": { ... } | null, "expected": 12 }

Rules:
- One fact per marker. A marker may contain at most one number, and that number must be the one its check verifies. "741 customers, up from 442, a 68% increase" is three markers with three claims, not one. If you can't write a check for a number, leave the number out.
- "expected" must be the number exactly as written in the text, in the same units (a displayed "$1.2M" is 1200000; "14%" is 14). The verifier grades with rounding semantics at the precision you write, so write numbers the way you'd display them.
- Only reference queries and columns that exist in the results. Use dimension values exactly as they appear.
- Do not invent context that is not in the data (causes, external events). Hedge interpretations and keep them out of claim markers.
- Output JSON only.`;

const REPAIR_SYSTEM = `${NARRATE_SYSTEM}

You are now revising a narrative after verification. You will be given the previous narrative and the verifier's findings for the claims that failed, including the true values.
Rewrite the narrative so every claim is correct: fix wrong numbers using the true values, fix bad references, or drop claims that cannot be supported. Keep verified claims unchanged (same ids and text). Return the complete revised narrative JSON.`;

function compactRows(rows: Row[]): Row[] {
  return rows.slice(0, RESULT_ROWS_FOR_MODEL).map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "number" ? roundSig(v) : v])),
  );
}

export function serializeResults(results: Record<string, QueryResult>) {
  return Object.values(results).map((r) => ({
    id: r.id,
    title: r.title,
    columns: r.columns.map((c) => `${c.name} (${c.role})`),
    totalRows: r.rows.length,
    rows: compactRows(r.rows),
    ...(r.rows.length > RESULT_ROWS_FOR_MODEL ? { note: `showing first ${RESULT_ROWS_FOR_MODEL} rows` } : {}),
  }));
}

export interface PlanInput {
  question: string;
  summary: DatasetSummary;
  history?: { question: string; headline: string }[];
}

export interface NarrateInput extends PlanInput {
  plan: Plan;
  results: ReturnType<typeof serializeResults>;
}

export interface RepairInput extends NarrateInput {
  narrative: Narrative;
  failures: Verdict[];
}

function datasetBlock(s: DatasetSummary): string {
  return JSON.stringify({ dataset: s.name, rowCount: s.rowCount, columns: s.columns, sampleRows: s.sampleRows });
}

export function buildPlanMessages(input: PlanInput): ChatMessage[] {
  const history = input.history?.length
    ? `\n\nEarlier questions in this session (for context):\n${input.history.map((h) => `- ${h.question} → ${h.headline}`).join("\n")}`
    : "";
  return [
    { role: "system", content: PLAN_SYSTEM },
    { role: "user", content: `Dataset:\n${datasetBlock(input.summary)}${history}\n\nQuestion: ${input.question}\n\nReturn the JSON plan.` },
  ];
}

export function buildNarrateMessages(input: NarrateInput): ChatMessage[] {
  return [
    { role: "system", content: NARRATE_SYSTEM },
    {
      role: "user",
      content: [
        `Dataset: ${input.summary.name} (${input.summary.rowCount} rows)`,
        `Question: ${input.question}`,
        `Plan intent: ${input.plan.intent}`,
        input.plan.assumptions?.length ? `Assumptions: ${input.plan.assumptions.join("; ")}` : "",
        `Query results:\n${JSON.stringify(input.results)}`,
        "Return the narrative JSON.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
}

export function buildRepairMessages(input: RepairInput): ChatMessage[] {
  return [
    { role: "system", content: REPAIR_SYSTEM },
    {
      role: "user",
      content: [
        `Question: ${input.question}`,
        `Query results:\n${JSON.stringify(input.results)}`,
        `Previous narrative:\n${JSON.stringify(input.narrative)}`,
        `Verifier findings for failed claims:\n${JSON.stringify(
          input.failures.map((f) => ({
            claim: f.claimId,
            status: f.status,
            checked: f.check,
            stated: f.expected,
            actual: f.actual,
            note: f.note,
          })),
        )}`,
        "Return the complete revised narrative JSON.",
      ].join("\n\n"),
    },
  ];
}

/** Appended when the model's JSON fails schema validation or execution. */
export function correctionMessages(previous: string, error: string): ChatMessage[] {
  return [
    { role: "assistant", content: previous },
    {
      role: "user",
      content: `That output could not be used:\n${error}\n\nFix the problem and return the complete corrected JSON object only.`,
    },
  ];
}
