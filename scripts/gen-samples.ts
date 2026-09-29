/**
 * Generates the synthetic sample datasets in public/samples. Seeded, so the output
 * (and therefore every recorded demo) is reproducible:  npm run gen:samples
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260929);
const noise = (spread: number) => 1 + (rand() * 2 - 1) * spread;
const gauss = () => {
  const u = Math.max(rand(), 1e-9), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const pick = <T,>(items: T[], weights: number[]): T => {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) if ((r -= weights[i]) <= 0) return items[i];
  return items[items.length - 1];
};
const pad = (n: number) => String(n).padStart(2, "0");
const round2 = (n: number) => Math.round(n * 100) / 100;

function toCsv(rows: Record<string, string | number | boolean | null>[]): string {
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => (v === null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n";
}

// --- SaaS metrics: monthly, by region x plan -------------------------------
function saas() {
  const regions = ["North America", "EMEA", "APAC", "LATAM"];
  const plans = ["Starter", "Pro", "Enterprise"];
  const price = { Starter: 29, Pro: 99, Enterprise: 1150 } as const;
  const churnRate = { Starter: 0.045, Pro: 0.025, Enterprise: 0.01 } as const;
  const start: Record<string, number[]> = {
    "North America": [820, 410, 42],
    EMEA: [610, 300, 31],
    APAC: [190, 95, 8],
    LATAM: [150, 58, 4],
  };
  const newBase: Record<string, number[]> = {
    "North America": [48, 16, 1.6],
    EMEA: [36, 12, 1.2],
    APAC: [22, 8, 0.8],
    LATAM: [10, 3, 0.25],
  };
  const growth: Record<string, number> = { "North America": 1.012, EMEA: 1.01, APAC: 1.035, LATAM: 1.018 };

  const rows: Record<string, string | number>[] = [];
  const active: Record<string, number> = {};
  regions.forEach((r) => plans.forEach((p, i) => (active[`${r}|${p}`] = start[r][i])));

  for (let t = 0; t < 36; t++) {
    const year = 2023 + Math.floor(t / 12);
    const month = (t % 12) + 1;
    const q4Push = month >= 10 ? 1.15 : month === 8 ? 0.85 : 1;
    for (const region of regions) {
      plans.forEach((plan, i) => {
        const key = `${region}|${plan}`;
        const newC = Math.max(0, Math.round(newBase[region][i] * growth[region] ** t * q4Push * noise(0.2)));
        const emeaShock = region === "EMEA" && year === 2024 && month >= 6 && month <= 9 ? 2.6 : 1;
        const churned = Math.min(active[key], Math.round(active[key] * churnRate[plan as keyof typeof price] * emeaShock * noise(0.3)));
        active[key] = active[key] + newC - churned;
        const mrr = active[key] * price[plan as keyof typeof price] * noise(0.04);
        rows.push({
          month: `${year}-${pad(month)}`,
          region,
          plan,
          new_customers: newC,
          churned_customers: churned,
          active_customers: active[key],
          mrr: round2(mrr),
        });
      });
    }
  }
  return rows;
}

// --- Coffee shop: daily sales by store x category, 2025 ---------------------
function coffee() {
  const stores = ["Downtown", "Campus", "Airport", "Riverside"];
  const cats = ["Espresso", "Drip Coffee", "Tea", "Pastry", "Merch"];
  const basePrice: Record<string, number> = { Espresso: 4.75, "Drip Coffee": 3.25, Tea: 3.5, Pastry: 3.95, Merch: 18 };
  const base: Record<string, number[]> = {
    Downtown: [210, 160, 40, 120, 6],
    Campus: [170, 120, 75, 95, 9],
    Airport: [150, 140, 35, 110, 14],
    Riverside: [95, 70, 45, 85, 5],
  };
  const rows: Record<string, string | number>[] = [];
  for (let d = new Date(Date.UTC(2025, 0, 1)); d.getUTCFullYear() === 2025; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    const month = d.getUTCMonth() + 1;
    const weekend = dow === 0 || dow === 6;
    const holiday = (month === 12 && d.getUTCDate() >= 20) || iso === "2025-07-04" || iso === "2025-11-27";
    for (const store of stores) {
      let f = 1;
      if (store === "Downtown") f *= weekend ? 0.55 : 1.1;
      if (store === "Riverside") f *= weekend ? 1.7 : 0.85;
      if (store === "Campus") f *= month >= 6 && month <= 8 ? 0.45 : holiday ? 0.35 : weekend ? 0.7 : 1.1;
      if (store === "Airport") f *= month === 11 || month === 12 || month === 7 ? 1.25 : 1;
      cats.forEach((cat, i) => {
        let cf = f;
        if (cat === "Tea") cf *= month <= 2 || month >= 11 ? 1.35 : month >= 6 && month <= 8 ? 0.7 : 1;
        if (cat === "Merch") cf *= month === 12 ? 2.4 : 1;
        const units = Math.max(0, Math.round(base[store][i] * cf * noise(0.18)));
        const priceBump = cat === "Espresso" && iso >= "2025-07-01" ? 1.08 : 1;
        const unit_price = round2(basePrice[cat] * priceBump * (store === "Airport" ? 1.2 : 1));
        rows.push({ date: iso, store, category: cat, units, unit_price, revenue: round2(units * unit_price) });
      });
    }
  }
  return rows;
}

// --- Support tickets --------------------------------------------------------
function tickets() {
  const channels = ["Email", "Chat", "Phone", "Social"];
  const priorities = ["Low", "Medium", "High", "Urgent"];
  const categories = ["Billing", "Bug", "How-to", "Account", "Feature request"];
  const agents = ["Avery", "Blake", "Casey", "Devon", "Emery", "Finley", "Harper", "Jordan"];
  const agentSpeed = [1, 0.8, 1.25, 0.95, 1.1, 0.7, 1.4, 1];
  const firstResp: Record<string, number> = { Email: 190, Chat: 4, Phone: 1.5, Social: 95 };
  const resBase: Record<string, number> = { Billing: 6, Bug: 38, "How-to": 3, Account: 8, "Feature request": 20 };
  const prioFactor: Record<string, number> = { Low: 1.4, Medium: 1, High: 0.7, Urgent: 0.35 };

  const rows: Record<string, string | number | boolean | null>[] = [];
  let id = 10001;
  for (let d = new Date(Date.UTC(2025, 0, 1)); d < new Date(Date.UTC(2025, 9, 1)); d.setUTCDate(d.getUTCDate() + 1)) {
    const month = d.getUTCMonth() + 1;
    const dow = d.getUTCDay();
    const may = month === 5;
    const volume = Math.round((dow === 0 || dow === 6 ? 7 : 17) * (may ? 1.65 : 1) * noise(0.25));
    for (let k = 0; k < volume; k++) {
      const channel = pick(channels, [42, 33, 15, 10]);
      const priority = pick(priorities, [30, 42, 20, 8]);
      const category = pick(categories, may ? [18, 45, 17, 12, 8] : [24, 22, 26, 16, 12]);
      const ai = Math.floor(rand() * agents.length);
      const hour = Math.min(23, Math.max(0, Math.round(13 + gauss() * 3.5)));
      const minute = Math.floor(rand() * 60);
      const backlog = may ? 2.1 : 1;
      const fr = firstResp[channel] * prioFactor[priority] * agentSpeed[ai] * backlog * Math.exp(gauss() * 0.45);
      const res = resBase[category] * prioFactor[priority] * agentSpeed[ai] * (may ? 1.5 : 1) * Math.exp(gauss() * 0.6);
      const reopened = rand() < (category === "Bug" ? 0.16 : 0.05);
      const csatRaw = 4.7 - Math.log1p(res) * 0.32 - (reopened ? 1.1 : 0) + gauss() * 0.7;
      const csat = rand() < 0.35 ? null : Math.min(5, Math.max(1, Math.round(csatRaw)));
      rows.push({
        ticket_id: `T-${id++}`,
        created_at: `${d.toISOString().slice(0, 10)} ${pad(hour)}:${pad(minute)}`,
        channel,
        priority,
        category,
        agent: agents[ai],
        first_response_min: round2(fr),
        resolution_hours: round2(res),
        reopened,
        csat,
      });
    }
  }
  return rows;
}

const out = join(process.cwd(), "public", "samples");
mkdirSync(out, { recursive: true });
for (const [name, rows] of Object.entries({ saas_metrics: saas(), coffee_sales: coffee(), support_tickets: tickets() })) {
  writeFileSync(join(out, `${name}.csv`), toCsv(rows));
  console.log(`${name}.csv  ${rows.length} rows`);
}
