// What the ship phase costs, priced from a ledger of cuts runs (by default the published one, data/ledger.tsv): the
// same tasks, arms and caps, 20 runs a side, so each task and arm's ship runs are priced at its cuts runs' mean.
//   node price-g.mjs [ledger.tsv]
// A run's cost is every ledger row of its id (every turn and every correction round): each turn's share of the
// total_cost_usd Claude Code reported (a resumed session reports its running total, so a turn's share is that
// less the session's total before it). Prints each task and arm's mean and largest run against its cap, the
// whole phase (120 runs) at those means against ODCK_SHIP_CAP's ceiling, and the smoke run: one task, one run a side.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ARMS, CAP_MAX, CAP_VAR, FIX_ROUND_CAP, PHASE, PHASES, loadTask, phaseRuns } from "./bench-g.mjs";
import { MAX_ROUNDS } from "./fix.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LEDGER = process.argv[2] ?? path.join(HERE, "data", "ledger.tsv");
const usd = (n) => (Number.isFinite(n) ? `$${n.toFixed(2)}` : "n/a"); // n/a: a task and arm with no runs to price
const byRun = {};
for (const [phase, id, , cost] of fs.readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).map((l) => l.split("\t"))) if (phase === "cuts") byRun[id] = (byRun[id] ?? 0) + Number(cost);

export function price() {
  const rows = {};
  for (const [task, arm] of phaseRuns()) (rows[`${task} ${arm}`] ??= { task, arm, cap: loadTask(task).caps[ARMS[arm].side], costs: [], runs: 0 }).runs++;
  for (const [task, arm, n] of phaseRuns("cuts")) if (byRun[`${task}-${arm}-${n}`] !== undefined) rows[`${task} ${arm}`].costs.push(byRun[`${task}-${arm}-${n}`]);
  for (const r of Object.values(rows)) {
    r.mean = r.costs.reduce((a, b) => a + b, 0) / r.costs.length;
    r.max = Math.max(...r.costs);
  }
  const list = Object.values(rows);
  return { list, phase: list.reduce((n, r) => n + r.mean * r.runs, 0), measured: Object.values(byRun).reduce((a, b) => a + b, 0) };
}

if (import.meta.main) {
  const p = price();
  console.log(`The ${PHASE} phase, priced from ${Object.keys(byRun).length} cuts runs in ${LEDGER} (${usd(p.measured)} in all).\n`);
  console.log("| task | arm | runs in the phase | cuts runs priced from | mean a run | largest run | cap a run |");
  console.log("|---|---|---|---|---|---|---|");
  for (const r of p.list) console.log(`| ${r.task} | ${r.arm} | ${r.runs} | ${r.costs.length} | ${usd(r.mean)} | ${usd(r.max)} | ${usd(r.cap)} |`);
  const unpriced = p.list.filter((r) => !r.costs.length).map((r) => `${r.task} ${r.arm}`);
  const gap = unpriced.length ? ` (incomplete: no runs in the ledger for ${unpriced.join(", ")})` : "";
  console.log(`\nThe whole phase (bench.sh ${PHASE}): ${usd(p.phase)} expected at these means${gap}; ${CAP_VAR} is required and may be set up to ${usd(CAP_MAX)}. A run starts only when its own cap fits under what is left, and each run may add up to ${MAX_ROUNDS} correction rounds of up to ${usd(FIX_ROUND_CAP)} each, clamped to what is left.`);
  console.log(`\nThe smoke run, one task with one run a side (bench.sh run <task> plain-close ${PHASES[PHASE]}, then kit-close ${PHASES[PHASE]})${gap}:\n`);
  console.log("| task | expected (both runs) | largest seen (both runs) | the two runs' caps |");
  console.log("|---|---|---|---|");
  for (const task of [...new Set(p.list.map((r) => r.task))]) {
    const two = p.list.filter((r) => r.task === task);
    console.log(`| ${task} | ${usd(two.reduce((n, r) => n + r.mean, 0))} | ${usd(two.reduce((n, r) => n + r.max, 0))} | ${usd(two.reduce((n, r) => n + r.cap, 0))} |`);
  }
}
