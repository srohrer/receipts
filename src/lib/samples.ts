export interface SampleMeta {
  id: string;
  name: string;
  file: string;
  description: string;
  questions: string[];
}

export const SAMPLES: SampleMeta[] = [
  {
    id: "saas_metrics",
    name: "SaaS metrics",
    file: "/samples/saas_metrics.csv",
    description: "36 months of customers, churn and MRR by region and plan.",
    questions: [
      "Which region is growing MRR fastest, and how does it compare to the others?",
      "What happened to EMEA churn in 2024?",
      "How is MRR split across plans in the latest month?",
    ],
  },
  {
    id: "coffee_sales",
    name: "Coffee sales",
    file: "/samples/coffee_sales.csv",
    description: "A year of daily sales for four stores across five product categories.",
    questions: [
      "Which store depends most on weekend sales?",
      "How did Espresso revenue change after the July price increase?",
      "Show monthly revenue by category. What stands out?",
    ],
  },
  {
    id: "support_tickets",
    name: "Support tickets",
    file: "/samples/support_tickets.csv",
    description: "Nine months of support tickets with response times, resolution and CSAT.",
    questions: [
      "What happened in May?",
      "Which channel has the slowest first response?",
      "Does resolution time affect CSAT?",
    ],
  },
];
