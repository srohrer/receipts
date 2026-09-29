/**
 * Hand-written walkthroughs, used only when no API key is available. They are labeled
 * "scripted" in the UI. The outputs below stand in for model text; everything
 * downstream (query execution, verification, the repair trigger) runs for real.
 * `npm run record:demos` replaces them with captured live runs.
 *
 * Two of them deliberately contain the kinds of mistakes LLMs make on data —
 * an arithmetic slip, a wrong ranking, a reference to a value that doesn't exist —
 * so the verifier and repair loop have something to catch.
 */
import type { DemoRecording } from "@/lib/transports";

const json = (o: unknown) => JSON.stringify(o, null, 2);

const ref = (query: string, where: Record<string, string>, field: string) => ({ query, where, field });

// ---------------------------------------------------------------------------
const saasGrowth: DemoRecording = {
  datasetId: "saas_metrics",
  question: "Which region is growing MRR fastest, and how does it compare to the others?",
  source: "scripted",
  outputs: {
    plan: json({
      intent: "Compare MRR growth across regions over the full period and show each region's trajectory.",
      assumptions: [
        "MRR is a point-in-time monthly figure, so growth compares December 2023 with December 2025 rather than summing months.",
      ],
      queries: [
        {
          id: "mrr_by_month",
          title: "MRR by region, monthly",
          groupBy: [{ column: "month", bucket: "month", as: "month" }, "region"],
          aggregates: [{ fn: "sum", column: "mrr", as: "mrr" }],
        },
        {
          id: "mrr_growth",
          title: "MRR by region, Dec 2023 vs Dec 2025",
          filters: [{ column: "month", bucket: "month", op: "in", value: ["2023-12", "2025-12"] }],
          groupBy: ["region", { column: "month", bucket: "year", as: "year" }],
          aggregates: [{ fn: "sum", column: "mrr", as: "mrr" }],
        },
        {
          id: "mrr_latest",
          title: "MRR by region, Dec 2025",
          filters: [{ column: "month", bucket: "month", op: "eq", value: "2025-12" }],
          groupBy: ["region"],
          aggregates: [{ fn: "sum", column: "mrr", as: "mrr" }],
          sort: [{ by: "mrr", dir: "desc" }],
        },
      ],
      chart: {
        type: "line",
        query: "mrr_by_month",
        x: "month",
        y: ["mrr"],
        series: "region",
        title: "Monthly MRR by region",
        yFormat: "currency",
      },
    }),
    narrate: json({
      headline: "APAC is growing MRR fastest — nearly tripling in two years.",
      body:
        "[[c1|APAC grew MRR 182%]] from December 2023 to December 2025, [[c2|about 2.8x]] its starting point and far ahead of " +
        "[[c3|North America at 48%]], [[c4|LATAM at 45%]] and [[c5|EMEA at 38%]]. APAC [[c6|has overtaken EMEA to become the second-largest region]], " +
        "while [[c7|North America still leads]] with [[c8|40% of December MRR]].",
      claims: [
        { id: "c1", statement: "APAC MRR grew 182% Dec 2023 → Dec 2025", check: { type: "pct_change", from: ref("mrr_growth", { region: "APAC", year: "2023" }, "mrr"), to: ref("mrr_growth", { region: "APAC", year: "2025" }, "mrr"), expected: 182 } },
        { id: "c2", statement: "APAC Dec 2025 MRR is 2.8x Dec 2023", check: { type: "ratio", numerator: ref("mrr_growth", { region: "APAC", year: "2025" }, "mrr"), denominator: ref("mrr_growth", { region: "APAC", year: "2023" }, "mrr"), expected: 2.8 } },
        { id: "c3", statement: "North America MRR grew 48%", check: { type: "pct_change", from: ref("mrr_growth", { region: "North America", year: "2023" }, "mrr"), to: ref("mrr_growth", { region: "North America", year: "2025" }, "mrr"), expected: 48 } },
        { id: "c4", statement: "LATAM MRR grew 45%", check: { type: "pct_change", from: ref("mrr_growth", { region: "LATAM", year: "2023" }, "mrr"), to: ref("mrr_growth", { region: "LATAM", year: "2025" }, "mrr"), expected: 45 } },
        { id: "c5", statement: "EMEA MRR grew 38%", check: { type: "pct_change", from: ref("mrr_growth", { region: "EMEA", year: "2023" }, "mrr"), to: ref("mrr_growth", { region: "EMEA", year: "2025" }, "mrr"), expected: 38 } },
        { id: "c6", statement: "APAC is the #2 region by Dec 2025 MRR", check: { type: "rank", ref: ref("mrr_latest", { region: "APAC" }, "mrr"), rank: 2, order: "desc" } },
        { id: "c7", statement: "North America is the #1 region by Dec 2025 MRR", check: { type: "rank", ref: ref("mrr_latest", { region: "North America" }, "mrr"), rank: 1, order: "desc" } },
        { id: "c8", statement: "North America has 40% of Dec 2025 MRR", check: { type: "share", ref: ref("mrr_latest", { region: "North America" }, "mrr"), expected: 40 } },
      ],
      caveats: ["Growth rates compare two single months, so one unusual month at either end would skew them."],
    }),
    repair: json({
      headline: "APAC is growing MRR fastest — nearly tripling in two years.",
      body:
        "[[c1|APAC grew MRR 182%]] from December 2023 to December 2025, [[c2|about 2.8x]] its starting point and far ahead of " +
        "[[c4|LATAM at 55%]], [[c3|North America at 48%]] and [[c5|EMEA at 38%]]. APAC [[c6|is now the third-largest region]], " +
        "[[c9|just behind EMEA]] ([[c10|$142.7K]] vs [[c11|$146.1K]]), while [[c7|North America still leads]] with [[c8|40% of December MRR]].",
      claims: [
        { id: "c1", statement: "APAC MRR grew 182% Dec 2023 → Dec 2025", check: { type: "pct_change", from: ref("mrr_growth", { region: "APAC", year: "2023" }, "mrr"), to: ref("mrr_growth", { region: "APAC", year: "2025" }, "mrr"), expected: 182 } },
        { id: "c2", statement: "APAC Dec 2025 MRR is 2.8x Dec 2023", check: { type: "ratio", numerator: ref("mrr_growth", { region: "APAC", year: "2025" }, "mrr"), denominator: ref("mrr_growth", { region: "APAC", year: "2023" }, "mrr"), expected: 2.8 } },
        { id: "c3", statement: "North America MRR grew 48%", check: { type: "pct_change", from: ref("mrr_growth", { region: "North America", year: "2023" }, "mrr"), to: ref("mrr_growth", { region: "North America", year: "2025" }, "mrr"), expected: 48 } },
        { id: "c4", statement: "LATAM MRR grew 55%", check: { type: "pct_change", from: ref("mrr_growth", { region: "LATAM", year: "2023" }, "mrr"), to: ref("mrr_growth", { region: "LATAM", year: "2025" }, "mrr"), expected: 55 } },
        { id: "c5", statement: "EMEA MRR grew 38%", check: { type: "pct_change", from: ref("mrr_growth", { region: "EMEA", year: "2023" }, "mrr"), to: ref("mrr_growth", { region: "EMEA", year: "2025" }, "mrr"), expected: 38 } },
        { id: "c6", statement: "APAC is the #3 region by Dec 2025 MRR", check: { type: "rank", ref: ref("mrr_latest", { region: "APAC" }, "mrr"), rank: 3, order: "desc" } },
        { id: "c9", statement: "APAC Dec 2025 MRR is below EMEA's", check: { type: "compare", left: ref("mrr_latest", { region: "APAC" }, "mrr"), right: ref("mrr_latest", { region: "EMEA" }, "mrr"), op: "lt" } },
        { id: "c10", statement: "APAC Dec 2025 MRR is $142.7K", check: { type: "value", ref: ref("mrr_latest", { region: "APAC" }, "mrr"), expected: 142700 } },
        { id: "c11", statement: "EMEA Dec 2025 MRR is $146.1K", check: { type: "value", ref: ref("mrr_latest", { region: "EMEA" }, "mrr"), expected: 146100 } },
        { id: "c7", statement: "North America is the #1 region by Dec 2025 MRR", check: { type: "rank", ref: ref("mrr_latest", { region: "North America" }, "mrr"), rank: 1, order: "desc" } },
        { id: "c8", statement: "North America has 40% of Dec 2025 MRR", check: { type: "share", ref: ref("mrr_latest", { region: "North America" }, "mrr"), expected: 40 } },
      ],
      caveats: ["Growth rates compare two single months, so one unusual month at either end would skew them."],
    }),
  },
};

// ---------------------------------------------------------------------------
const coffeeWeekend: DemoRecording = {
  datasetId: "coffee_sales",
  question: "Which store depends most on weekend sales?",
  source: "scripted",
  outputs: {
    plan: json({
      intent: "Compare each store's average revenue on weekend days against weekdays.",
      assumptions: ["Weekend means Saturday and Sunday.", "Per-day averages correct for there being 5 weekdays and 2 weekend days."],
      queries: [
        {
          id: "by_daytype",
          title: "Average daily revenue, weekday vs weekend",
          groupBy: ["store", { column: "date", bucket: "daytype", as: "day_type" }],
          aggregates: [
            { fn: "sum", column: "revenue", as: "revenue" },
            { fn: "count_distinct", column: "date", as: "days" },
          ],
          computed: [{ as: "revenue_per_day", op: "div", left: "revenue", right: "days" }],
        },
        {
          id: "weekend_totals",
          title: "Weekend revenue by store",
          filters: [{ column: "date", bucket: "daytype", op: "eq", value: "Weekend" }],
          groupBy: ["store"],
          aggregates: [{ fn: "sum", column: "revenue", as: "weekend_revenue" }],
          sort: [{ by: "weekend_revenue", dir: "desc" }],
        },
      ],
      chart: {
        type: "bar",
        query: "by_daytype",
        x: "store",
        y: ["revenue_per_day"],
        series: "day_type",
        title: "Average daily revenue: weekday vs weekend",
        yFormat: "currency",
      },
    }),
    narrate: json({
      headline: "Riverside is the weekend store — its Saturdays and Sundays earn twice its weekdays.",
      body:
        "At Riverside, [[c1|an average weekend day brings in about $2,200]], [[c2|roughly 2x a typical weekday]]. " +
        "Downtown is the mirror image: [[c3|weekend days earn about half]] what its weekdays do, and Campus dips too ([[c4|0.68x]]). " +
        "[[c5|Airport is essentially flat across the week]], and because it is the busiest store it still [[c6|takes the biggest share of weekend revenue]], at [[c7|35%]].",
      claims: [
        { id: "c1", statement: "Riverside averages ~$2,200 per weekend day", check: { type: "value", ref: ref("by_daytype", { store: "Riverside", day_type: "Weekend" }, "revenue_per_day"), expected: 2200 } },
        { id: "c2", statement: "Riverside weekend days earn ~2x weekdays", check: { type: "ratio", numerator: ref("by_daytype", { store: "Riverside", day_type: "Weekend" }, "revenue_per_day"), denominator: ref("by_daytype", { store: "Riverside", day_type: "Weekday" }, "revenue_per_day"), expected: 2 } },
        { id: "c3", statement: "Downtown weekend days earn ~0.5x weekdays", check: { type: "ratio", numerator: ref("by_daytype", { store: "Downtown", day_type: "Weekend" }, "revenue_per_day"), denominator: ref("by_daytype", { store: "Downtown", day_type: "Weekday" }, "revenue_per_day"), expected: 0.5 } },
        { id: "c4", statement: "Campus weekend days earn 0.68x weekdays", check: { type: "ratio", numerator: ref("by_daytype", { store: "Campus", day_type: "Weekend" }, "revenue_per_day"), denominator: ref("by_daytype", { store: "Campus", day_type: "Weekday" }, "revenue_per_day"), expected: 0.68 } },
        { id: "c5", statement: "Airport weekend and weekday revenue per day are about equal", check: { type: "compare", left: ref("by_daytype", { store: "Airport", day_type: "Weekend" }, "revenue_per_day"), right: ref("by_daytype", { store: "Airport", day_type: "Weekday" }, "revenue_per_day"), op: "eq" } },
        { id: "c6", statement: "Airport has the most weekend revenue", check: { type: "rank", ref: ref("weekend_totals", { store: "Airport" }, "weekend_revenue"), rank: 1, order: "desc" } },
        { id: "c7", statement: "Airport has 35% of weekend revenue", check: { type: "share", ref: ref("weekend_totals", { store: "Airport" }, "weekend_revenue"), expected: 35 } },
      ],
      caveats: ["Averages include holidays, which fall on both weekdays and weekends."],
    }),
  },
};

// ---------------------------------------------------------------------------
const supportMay: DemoRecording = {
  datasetId: "support_tickets",
  question: "What happened in May?",
  source: "scripted",
  outputs: {
    plan: json({
      intent: "Find what was unusual about May: ticket volume, service levels, satisfaction and ticket mix.",
      assumptions: ["May refers to May 2025, the only May in the data."],
      queries: [
        {
          id: "monthly",
          title: "Volume and service levels by month",
          groupBy: [{ column: "created_at", bucket: "month", as: "month" }],
          aggregates: [
            { fn: "count", as: "tickets" },
            { fn: "median", column: "resolution_hours", as: "median_resolution_h" },
            { fn: "avg", column: "csat", as: "avg_csat" },
          ],
        },
        {
          id: "may_mix",
          title: "Ticket mix in May",
          filters: [{ column: "created_at", bucket: "month", op: "eq", value: "2025-05" }],
          groupBy: ["category"],
          aggregates: [{ fn: "count", as: "tickets" }],
          sort: [{ by: "tickets", dir: "desc" }],
        },
        {
          id: "other_mix",
          title: "Ticket mix in all other months",
          filters: [{ column: "created_at", bucket: "month", op: "neq", value: "2025-05" }],
          groupBy: ["category"],
          aggregates: [{ fn: "count", as: "tickets" }],
          sort: [{ by: "tickets", dir: "desc" }],
        },
      ],
      chart: { type: "bar", query: "monthly", x: "month", y: ["tickets"], title: "Tickets per month", yFormat: "number" },
    }),
    narrate: json({
      headline: "May had a surge of bug reports that nearly doubled volume and slowed resolution.",
      body:
        "May saw [[c1|756 tickets]], [[c2|73% more than April]]. The extra load was mostly bugs: [[c3|48% of May tickets were bugs]], versus [[c4|22% in other months]]. " +
        "Service suffered — [[c5|median resolution time rose to 22.5 hours]], [[c6|about 2.7x April]] — and [[c7|average CSAT fell to 3.52]], [[c8|the lowest of any month]]. " +
        "[[c9|By June, median resolution was back to about 8 hours]].",
      claims: [
        { id: "c1", statement: "May had 756 tickets", check: { type: "value", ref: ref("monthly", { month: "2025-05" }, "tickets"), expected: 756 } },
        { id: "c2", statement: "May had 73% more tickets than April", check: { type: "pct_change", from: ref("monthly", { month: "2025-04" }, "tickets"), to: ref("monthly", { month: "2025-05" }, "tickets"), expected: 73 } },
        { id: "c3", statement: "48% of May tickets were bugs", check: { type: "share", ref: ref("may_mix", { category: "Bugs" }, "tickets"), expected: 48 } },
        { id: "c4", statement: "22% of tickets in other months were bugs", check: { type: "share", ref: ref("other_mix", { category: "Bug" }, "tickets"), expected: 22 } },
        { id: "c5", statement: "May median resolution was 22.5 hours", check: { type: "value", ref: ref("monthly", { month: "2025-05" }, "median_resolution_h"), expected: 22.5 } },
        { id: "c6", statement: "May median resolution was 2.7x April's", check: { type: "ratio", numerator: ref("monthly", { month: "2025-05" }, "median_resolution_h"), denominator: ref("monthly", { month: "2025-04" }, "median_resolution_h"), expected: 2.7 } },
        { id: "c7", statement: "May average CSAT was 3.52", check: { type: "value", ref: ref("monthly", { month: "2025-05" }, "avg_csat"), expected: 3.52 } },
        { id: "c8", statement: "May had the lowest average CSAT", check: { type: "rank", ref: ref("monthly", { month: "2025-05" }, "avg_csat"), rank: 1, order: "asc" } },
        { id: "c9", statement: "June median resolution was about 8 hours", check: { type: "value", ref: ref("monthly", { month: "2025-06" }, "median_resolution_h"), expected: 8 } },
      ],
      caveats: [
        "The data shows what changed, not why. The jump in bug tickets suggests a product issue, but nothing in this dataset confirms a cause.",
        "About a third of tickets have no CSAT response, so satisfaction averages cover only those who answered.",
      ],
    }),
    repair: json({
      headline: "May had a surge of bug reports that nearly doubled volume and slowed resolution.",
      body:
        "May saw [[c1|756 tickets]], [[c2|73% more than April]]. The extra load was mostly bugs: [[c3|48% of May tickets were bugs]], versus [[c4|22% in other months]]. " +
        "Service suffered — [[c5|median resolution time rose to 22.5 hours]], [[c6|about 2.7x April]] — and [[c7|average CSAT fell to 3.52]], [[c8|the lowest of any month]]. " +
        "[[c9|By June, median resolution was back to about 8 hours]].",
      claims: [
        { id: "c1", statement: "May had 756 tickets", check: { type: "value", ref: ref("monthly", { month: "2025-05" }, "tickets"), expected: 756 } },
        { id: "c2", statement: "May had 73% more tickets than April", check: { type: "pct_change", from: ref("monthly", { month: "2025-04" }, "tickets"), to: ref("monthly", { month: "2025-05" }, "tickets"), expected: 73 } },
        { id: "c3", statement: "48% of May tickets were bugs", check: { type: "share", ref: ref("may_mix", { category: "Bug" }, "tickets"), expected: 48 } },
        { id: "c4", statement: "22% of tickets in other months were bugs", check: { type: "share", ref: ref("other_mix", { category: "Bug" }, "tickets"), expected: 22 } },
        { id: "c5", statement: "May median resolution was 22.5 hours", check: { type: "value", ref: ref("monthly", { month: "2025-05" }, "median_resolution_h"), expected: 22.5 } },
        { id: "c6", statement: "May median resolution was 2.7x April's", check: { type: "ratio", numerator: ref("monthly", { month: "2025-05" }, "median_resolution_h"), denominator: ref("monthly", { month: "2025-04" }, "median_resolution_h"), expected: 2.7 } },
        { id: "c7", statement: "May average CSAT was 3.52", check: { type: "value", ref: ref("monthly", { month: "2025-05" }, "avg_csat"), expected: 3.52 } },
        { id: "c8", statement: "May had the lowest average CSAT", check: { type: "rank", ref: ref("monthly", { month: "2025-05" }, "avg_csat"), rank: 1, order: "asc" } },
        { id: "c9", statement: "June median resolution was about 8 hours", check: { type: "value", ref: ref("monthly", { month: "2025-06" }, "median_resolution_h"), expected: 8 } },
      ],
      caveats: [
        "The data shows what changed, not why. The jump in bug tickets suggests a product issue, but nothing in this dataset confirms a cause.",
        "About a third of tickets have no CSAT response, so satisfaction averages cover only those who answered.",
      ],
    }),
  },
};

export const SCRIPTED: DemoRecording[] = [saasGrowth, coffeeWeekend, supportMay];
