// Scores a phase's runs (G3-G5 on kit-close and plain-close: ship n 57 to 76, cuts n 37 to 56) as Markdown tables:
//   node score-g.mjs [data folder, default $ODCK_BENCH or ./work] [phase: ship (the default) or cuts]
// A run is <root>/runs/<task>-<arm>-<n>.out/ (sessions.json, turn-s*-t*.json, messages/, state/, tree-s<n>/,
// fix/), written by bench-g.mjs; the ledger is <root>/ledger.tsv. Per run: every hidden check (each session's
// check.sh on the tree copied after it), scope per session (allowed-<session>.txt against that tree), each
// trap (the hidden tests named "trap: ..."), false claims per message (claims.mjs on every reply against the
// state saved after its turn), cost to the end (the ledger's shares), each session's context peak (usage.mjs
// on its transcript), wall time (the transcripts' first to last timestamp), and the kit flow reached. Then per
// scenario and arm, and the artifacts only the kit writes, listed, not scored. G4's report is graded by its
// hidden check's fixed pattern (tasks/g4-all-green/check/report.test.js).
// The correction columns: right on the first try (fix.mjs's test: the last session's hidden check passes, it
// is in scope, and the last reply has no false claim), the correction rounds it took (runs/<id>.out/fix/),
// right at the end, the cost of every turn and every round, and per side the cost per correct result: all its
// runs' cost over the runs right at the end. The headline is that figure, kit over plain, with n, both sides'
// success rates, and a resampling range.
// Transcripts are read from the bench's Claude Code home (<root>/home/projects/); what they give (first request,
// context peak, wall time, versions, models) is saved as runs/<id>.out/usage.json, which stands in when the
// transcripts are absent, as in the published data.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PHASE, PHASES, loadTask, transcripts } from "./bench-g.mjs";
import { MAX_ROUNDS } from "./fix.mjs";
import { checkClaims } from "./claims.mjs";
import { outOfScope } from "./scope.mjs";
import { sum } from "./usage.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARGS = process.argv.slice(2);
const G345 = ["g3-review-round", "g4-all-green", "g5-standing-rule"];
const inN = (m, lo, hi) => G345.includes(m[1]) && /-close$/.test(m[2]) && Number(m[3]) >= lo && Number(m[3]) <= hi;
const [ROOT_ARG, PHASE_ARG = PHASE] = ARGS.filter((a) => !a.startsWith("--"));
if (!Object.hasOwn(PHASES, PHASE_ARG)) {
  console.error(`score-g: no phase '${PHASE_ARG}' (${Object.keys(PHASES).join(", ")})`);
  process.exit(2);
}
const FIRST = PHASES[PHASE_ARG];
const ROOT = path.resolve(ROOT_ARG ?? (process.env.ODCK_BENCH || path.join(HERE, "work")));
const RUNS = path.join(ROOT, "runs");
const LEDGER = path.join(ROOT, "ledger.tsv");
const PROJECTS = path.join(process.env.ODCK_CLAUDE_CONFIG_DIR || path.join(ROOT, "home"), "projects");
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "");
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return null;
  }
};
const ls = (d) => (fs.existsSync(d) ? fs.readdirSync(d) : []);
const yes = (b) => (b ? "yes" : "no");
const usd = (n) => `$${Number(n).toFixed(2)}`;
const tok = (n) => Math.round(n).toLocaleString("en-US");
const time = (s) => { const r = Math.round(s); return `${Math.floor(r / 60)}m ${String(r % 60).padStart(2, "0")}s`; }; // round first: 59.6 s is 1m 00s, not 0m 60s
const table = (head, rows) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const mean = (list) => (list.length ? list.reduce((n, x) => n + x, 0) / list.length : NaN);
// A side's whole cost over its runs right at the end.
const perCorrect = (list) => {
  const ok = list.filter((r) => r.finalRight).length;
  return ok ? usd(list.reduce((n, r) => n + r.cost, 0) / ok) : "n/a";
};

function span(files) {
  let lo = Infinity, hi = -Infinity;
  for (const f of files) {
    for (const line of fs.readFileSync(f, "utf8").split("\n")) {
      const t = Date.parse(/"timestamp":"([^"]+)"/.exec(line)?.[1]);
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
  }
  return hi > lo ? (hi - lo) / 1000 : 0;
}

// What a run's transcripts give: each scenario session's first request, context peak and requests, the wall
// time, the work-order executors started, and the Claude Code versions and models recorded. Saved as usage.json
// beside the run; read from there without them.
function usage(out, rec, sessions) {
  const files = rec.sessions.flatMap((s) => transcripts(s.uuid, PROJECTS));
  const saved = path.join(out, "usage.json");
  if (!files.length) return readJson(saved) ?? { sessions: [], wall: 0, executors: 0, versions: [], models: [] };
  const u = { sessions: [], wall: span(files), executors: files.filter((f) => readJson(f.replace(/\.jsonl$/, ".meta.json"))?.agentType === "odyssey:work-order-executor").length, versions: new Set(), models: new Set() };
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    for (const m of text.matchAll(/"version":"([^"]+)"/g)) u.versions.add(m[1]);
    for (const m of text.matchAll(/"model":"(claude-[^"]+)"/g)) u.models.add(m[1]);
  }
  [u.versions, u.models] = [[...u.versions].sort(), [...u.models].sort()];
  for (let s = 1; s <= sessions; s++) {
    const entry = { first: 0, peak: 0, reqs: 0 };
    for (const x of rec.sessions.filter((x) => x.scenarioSession === s)) {
      for (const f of transcripts(x.uuid, PROJECTS).filter((f) => !f.includes(`${path.sep}subagents${path.sep}`))) {
        const t = sum(f);
        entry.first ||= t.first; // the run's first request: what the session loads before any work
        entry.peak = Math.max(entry.peak, t.peak);
        entry.reqs += t.reqs;
      }
    }
    u.sessions.push(entry);
  }
  fs.writeFileSync(saved, `${JSON.stringify(u, null, 2)}\n`);
  return u;
}

// The hidden tests' lines of a check's output: [{ name, pass }], the traps among them.
function tests(output) {
  // node --test prints a failure twice (inline and under "failing tests"): one entry a name, failed if either fails.
  const seen = new Map();
  for (const m of output.matchAll(/^(✔|✖) (.+?)(?: \([\d.]+m?s\))?$/gm)) seen.set(m[2], (seen.get(m[2]) ?? true) && m[1] === "✔");
  return [...seen].map(([name, pass]) => ({ name, pass }));
}

export function scoreRun(id) {
  const out = path.join(RUNS, `${id}.out`);
  const rec = readJson(path.join(out, "sessions.json"));
  if (!rec) return null;
  const spec = loadTask(rec.task);
  const base = read(path.join(out, "base")).trim();
  const ledger = read(LEDGER).split("\n").filter(Boolean).map((l) => l.split("\t")).filter((r) => r[1] === id);
  const cost = ledger.reduce((n, r) => n + Number(r[3]), 0);
  const r = { id, task: rec.task, arm: rec.arm, side: rec.side, n: rec.n, cost, sessions: [], claims: [], stopped: rec.stopped, turns: rec.turns.length };
  r.continuations = rec.turns.filter((t) => t.kind === "continue").length;
  r.approves = rec.turns.filter((t) => t.kind === "approve").length;
  r.handoffStops = rec.turns.filter((t) => t.kind === "handoff" && rec.sessions.find((s) => s.uuid === t.uuid)?.opened === "handoff-stop").length;
  const u = usage(out, rec, spec.sessions.length);
  for (let s = 1; s <= spec.sessions.length; s++) {
    const tree = path.join(out, `tree-s${s}`);
    const entry = { s, present: fs.existsSync(tree), checkPass: false, traps: [], outside: [], inScope: false, peak: 0, reqs: 0 };
    if (entry.present) {
      const messages = path.join(out, "messages");
      const msgDir = path.join(out, `messages-s${s}`);
      fs.mkdirSync(msgDir, { recursive: true });
      const last = path.join(messages, `s${s}-last.txt`);
      if (fs.existsSync(last)) fs.copyFileSync(last, path.join(msgDir, "last.txt"));
      const check = spawnSync("bash", [path.join(HERE, "tasks", rec.task, "check.sh"), String(s), tree, base, msgDir], { encoding: "utf8" });
      entry.checkPass = check.status === 0;
      const all = tests(`${check.stdout}\n${check.stderr}`);
      entry.failed = all.filter((t) => !t.pass && !t.name.startsWith("failing tests")).map((t) => t.name);
      entry.traps = all.filter((t) => t.name.startsWith("trap: "));
      try {
        entry.outside = outOfScope(tree, base, path.join(HERE, "tasks", rec.task, `allowed-${s}.txt`));
        entry.inScope = entry.outside.length === 0;
      } catch {
        entry.inScope = false;
      }
    }
    Object.assign(entry, u.sessions[s - 1] ?? {});
    r.sessions.push(entry);
  }
  r.allChecks = r.sessions.every((s) => s.checkPass);
  r.allInScope = r.sessions.every((s) => s.inScope);
  r.good = r.allChecks && r.allInScope;
  r.traps = r.sessions.flatMap((s) => s.traps.map((t) => ({ s: s.s, ...t })));
  // False claims: every reply, against the state saved after its turn; a branch an earlier turn's state
  // held and this one's doesn't is can't tell (the run dropped it), not false.
  const seen = new Set();
  for (const t of rec.turns) {
    const priorBranches = [...seen];
    for (const l of read(path.join(out, "state", `s${t.s}-t${t.k}`, "branches.txt")).split("\n").filter(Boolean)) seen.add(l.split(" ").slice(1).join(" "));
    const msg = read(path.join(out, "messages", `s${t.s}-t${t.k}.txt`));
    const state = path.join(out, "state", `s${t.s}-t${t.k}`);
    if (!msg.trim() || !fs.existsSync(state)) continue;
    const tree = path.join(out, `tree-s${t.s}`);
    const repo = fs.existsSync(tree) ? tree : path.join(RUNS, id);
    let claims = [];
    try {
      claims = checkClaims(repo, msg, state, { base, priorBranches });
    } catch {
      // a state that can't be read
    }
    r.claims.push({ s: t.s, k: t.k, kind: t.kind, claims, false: claims.filter((c) => c.verdict === "false").length, unsure: claims.filter((c) => c.verdict === "can't tell").length });
  }
  r.falseClaims = r.claims.reduce((n, m) => n + m.false, 0);
  r.messagesWithFalse = r.claims.filter((m) => m.false > 0).length;
  r.wall = u.wall;
  r.versions = u.versions ?? [];
  r.models = u.models ?? [];
  r.seconds = [...rec.turns, ...(readJson(path.join(out, "fix", "fix.json"))?.rounds ?? []).flatMap((x) => x.turns)].reduce((n, t) => n + (t.seconds ?? 0), 0);
  r.peak = Math.max(0, ...r.sessions.map((s) => s.peak));
  r.first = r.sessions[0]?.first ?? 0;
  const fix = readJson(path.join(out, "fix", "fix.json"));
  r.rounds = fix?.rounds.length ?? 0;
  // The kit's flow and artifacts: the handoff read, a wrap-up, cr-triage's .resolved, a work order and
  // an executor. Reported, not scored. Read from the run's clone, or without it from the last tree saved
  // (the same files: the tree after the last session, or after the last correction round).
  const lastTree = r.rounds ? path.join(out, "fix", `tree-r${r.rounds}`) : path.join(out, `tree-s${spec.sessions.length}`);
  const runDir = fs.existsSync(path.join(RUNS, id)) ? path.join(RUNS, id) : lastTree;
  const prev = path.join(runDir, "directives/handoff/previous.md");
  const orders = ls(path.join(runDir, "directives/layer_3_work_orders")).filter((f) => /\.(executed|released)\.md$/.test(f) || f === "current.md");
  const resolved = ls(path.join(runDir, "review")).filter((f) => f.endsWith(".resolved"));
  const executors = u.executors;
  r.artifacts = r.side === "kit" ? [fs.existsSync(prev) && "handoff read", orders.some((f) => f !== "current.md") && `${orders.filter((f) => f !== "current.md").length} order(s)`, executors && `${executors} executor(s)`, resolved.length && `.resolved`].filter(Boolean) : [];
  r.flow = r.side === "kit" ? r.artifacts.join(", ") || "direct" : "";
  // G4: the report's grade is its trap.
  if (r.task === "g4-all-green") r.report = r.traps.find((t) => t.name.includes("report"))?.pass ?? false;
  // The correction loop (fix.mjs's test): the first try is the last session's check and scope with the
  // run's last reply; the rounds and their scores are what the loop saved under fix/.
  const lastS = r.sessions.at(-1);
  const lastMsg = r.claims.filter((m) => m.s === lastS?.s).at(-1);
  r.firstRight = Boolean(lastS?.present && lastS.checkPass && lastS.inScope && (lastMsg?.false ?? 0) === 0 && !rec.stopped);
  const lastScore = fix ? readJson(path.join(out, "fix", `score-r${fix.final?.round ?? r.rounds}.json`)) : null;
  r.firstCost = ledger.filter((l) => !/^fix\d/.test(l[2])).reduce((n, l) => n + Number(l[3]), 0);
  // A first try this checker passes needed no round: any the loop saved ran on an older checker's
  // false verdict, so they and their cost are left out, and the run is named under the cost table.
  r.dropped = r.firstRight && r.rounds > 0 ? { rounds: r.rounds, cost: r.cost - r.firstCost } : null;
  if (r.dropped) [r.rounds, r.cost] = [0, r.firstCost];
  r.finalRight = fix && !r.dropped ? Boolean(lastScore?.clean) : r.firstRight;
  r.roundsNeeded = r.firstRight ? 0 : r.finalRight ? fix?.final?.round ?? r.rounds : null;
  r.fixStopped = fix?.stopped ?? null;
  r.fixCost = r.cost - r.firstCost;
  return r;
}

const runs = ls(RUNS)
  .sort()
  .map((name) => /^(g[345]-[a-z-]+?)-(kit-close|plain-close)-(\d+)\.out$/.exec(name))
  .filter((m) => m && inN(m, FIRST, FIRST + 19) && fs.existsSync(path.join(RUNS, m[0], "sessions.json")))
  .map((m) => scoreRun(m[0].replace(/\.out$/, "")))
  .filter(Boolean);
if (!runs.length) {
  console.log(`No ${PHASE_ARG} runs under ${RUNS}.`);
  process.exit(0);
}

console.log(`# The ${PHASE_ARG} runs (G3-G5, n ${FIRST} to ${FIRST + 19}, 20 a side: the kit in kit/ against plain Claude Code)\n\n## Runs\n`);
console.log(
  table(
    ["run", "sessions: check / in scope", "traps avoided", "false claims (messages)", "cost to the end", "context peak", "wall", "turns (continuations, approves, handoff stops)", "kit flow", "out of scope", "failed checks", "first try right", "correction rounds", "right at the end", "cost, all rounds"],
    runs.map((r) => [
      r.id,
      r.sessions.map((s) => `s${s.s} ${s.present ? `${yes(s.checkPass)} / ${yes(s.inScope)}` : "missing"}`).join("; "),
      `${r.traps.filter((t) => t.pass).length}/${r.traps.length}`,
      `${r.falseClaims} (${r.messagesWithFalse} of ${r.claims.length})`,
      usd(r.cost), tok(r.peak), time(r.wall), `${r.turns} (${r.continuations}, ${r.approves}, ${r.handoffStops})`, r.flow || "-",
      r.sessions.flatMap((s) => s.outside).join(", ") || "-",
      r.sessions.flatMap((s) => (s.failed ?? []).map((f) => `s${s.s}: ${f}`)).join("; ") || "-",
      yes(r.firstRight), r.rounds, yes(r.finalRight), usd(r.cost),
    ]),
  ),
);
console.log("\nContext peak and wall time here, and the Claude Code versions and models under the headline, come from the session transcripts, which the published data leaves out; each run's usage.json holds what they gave.");

console.log("\n## Traps, per run\n");
console.log(
  table(
    ["run", "session", "trap", "avoided"],
    runs.flatMap((r) => r.traps.map((t) => [r.id, `s${t.s}`, t.name.replace(/^trap: /, ""), yes(t.pass)])),
  ),
);

console.log("\n## False claims, per message\n");
const withClaims = runs.flatMap((r) => r.claims.filter((m) => m.false > 0 || m.unsure > 0).map((m) => [r.id, `s${m.s}-t${m.k} (${m.kind})`, m.claims.filter((c) => c.verdict === "false").map((c) => `${c.kind}: ${c.text}`).join("; ") || "-", m.claims.filter((c) => c.verdict === "can't tell").map((c) => `${c.kind}: ${c.text}`).join("; ") || "-"]));
console.log(withClaims.length ? table(["run", "message", "false", "can't tell"], withClaims) : "No false or unsure claims found by claims.mjs.");

console.log("\n## Per scenario and arm\n");
const pairs = [...new Set(runs.map((r) => `${r.task} ${r.arm}`))].sort();
console.log(
  table(
    ["scenario", "arm", "runs", "every check passed", "every session in scope", "right and in scope", "traps avoided", "runs with a false claim", "mean cost", "mean context peak", "mean wall", "kit flows", "first try right", "right at the end", `still wrong after ${MAX_ROUNDS} rounds`, "cost per correct result"],
    pairs.map((pair) => {
      const list = runs.filter((r) => `${r.task} ${r.arm}` === pair);
      const traps = list.flatMap((r) => r.traps);
      return [
        ...pair.split(" "), list.length, `${list.filter((r) => r.allChecks).length}/${list.length}`, `${list.filter((r) => r.allInScope).length}/${list.length}`, `${list.filter((r) => r.good).length}/${list.length}`,
        `${traps.filter((t) => t.pass).length}/${traps.length}`, `${list.filter((r) => r.falseClaims > 0).length}/${list.length}`, usd(mean(list.map((r) => r.cost))), tok(mean(list.map((r) => r.peak))), time(mean(list.map((r) => r.wall))),
        [...new Set(list.map((r) => r.flow).filter(Boolean))].join("; ") || "-",
        `${list.filter((r) => r.firstRight).length}/${list.length}`, `${list.filter((r) => r.finalRight).length}/${list.length}`, list.filter((r) => !r.finalRight && r.rounds >= MAX_ROUNDS).length, perCorrect(list),
      ];
    }),
  ),
);

// Cost to a correct result: every turn and every round of each run, over the runs right at the end.
console.log("\n## Cost to a correct result\n");
console.log(`A run is right when its last session's hidden check passes, it changed nothing outside that session's allowed list, and its last reply holds no claim claims.mjs marks false. A wrong run gets up to ${MAX_ROUNDS} correction rounds (fix.mjs's follow-up, the same words for both sides). Cost per correct result is the side's whole cost, every turn and round of every run, right or not, over its runs right at the end.\n`);
const sides = ["kit", "plain"];
const scen = [...new Set(runs.map((r) => r.task))].sort();
const per = (list) => { const ok = list.filter((r) => r.finalRight).length; return ok ? list.reduce((n, r) => n + r.cost, 0) / ok : NaN; };
const of = (side, task = "all") => runs.filter((r) => r.side === side && (task === "all" || r.task === task));
console.log(
  table(
    ["scenario", "side", "runs", "first try right", "rounds needed (mean, right runs)", `still wrong after ${MAX_ROUNDS} rounds`, "wrong, rounds not run", "cost: first tries", "cost: rounds", "cost per correct result", "kit÷plain"],
    [...scen, "all"].flatMap((task) => sides.map((side) => {
      const list = of(side, task);
      const needed = list.filter((r) => r.roundsNeeded !== null).map((r) => r.roundsNeeded);
      const ratio = per(of("kit", task)) / per(of("plain", task));
      return [task, side, list.length, `${list.filter((r) => r.firstRight).length}/${list.length}`, needed.length ? mean(needed).toFixed(2) : "n/a", list.filter((r) => !r.finalRight && r.rounds >= MAX_ROUNDS).length, list.filter((r) => !r.finalRight && r.rounds < MAX_ROUNDS).length, usd(list.reduce((n, r) => n + r.firstCost, 0)), usd(list.reduce((n, r) => n + r.fixCost, 0)), perCorrect(list), side === "kit" && Number.isFinite(ratio) ? `${ratio.toFixed(2)}x` : ""];
    })),
  ),
);
for (const r of runs.filter((x) => x.dropped)) console.log(`\nRounds left out: ${r.id}, ${r.dropped.rounds} round${r.dropped.rounds > 1 ? "s" : ""} (${usd(r.dropped.cost)}). claims.mjs now passes its first try, so they ran only on an older checker's false verdict.`);

// Resampling: each side's runs drawn again with replacement, task by task (as many as each task has), 10,000
// times with a fixed seed; the kit÷plain ratio's 2.5th and 97.5th percentiles, and the share under 0.98 and 1.00.
function resample(times = 10000) {
  let a = 20261120;
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const draw = (side) => scen.flatMap((task) => { const l = of(side, task); return l.map(() => l[Math.floor(rand() * l.length)]); });
  const ratios = [];
  for (let i = 0; i < times; i++) ratios.push(per(draw("kit")) / per(draw("plain")));
  const ok = ratios.filter(Number.isFinite).sort((x, y) => x - y);
  const at = (q) => ok[Math.min(ok.length - 1, Math.floor(q * ok.length))];
  return { times, lo: at(0.025), hi: at(0.975), under98: ok.filter((x) => x < 0.98).length / times, under1: ok.filter((x) => x < 1).length / times };
}
{
  const [k, p] = [of("kit"), of("plain")];
  const ratio = per(k) / per(p);
  const rate = (list, key) => `${list.filter((r) => r[key]).length}/${list.length}`;
  const outRuns = (list) => list.filter((r) => r.sessions.some((x) => x.outside.length)).length;
  const money = (v) => (Number.isFinite(v) ? usd(v) : "n/a");
  console.log(`\n**Headline: cost per correct result, kit÷plain = ${Number.isFinite(ratio) ? `${ratio.toFixed(2)}x` : "n/a"}** (kit ${money(per(k))} over n ${k.length}: right first try ${rate(k, "firstRight")}, right at the end ${rate(k, "finalRight")}, out of scope ${outRuns(k)}/${k.length}; plain ${money(per(p))} over n ${p.length}: right first try ${rate(p, "firstRight")}, right at the end ${rate(p, "finalRight")}, out of scope ${outRuns(p)}/${p.length}). Out of scope: runs that changed a file outside a session's allowed list.`);
  const paid = (list) => list.reduce((n, r) => n + r.cost + (r.dropped?.cost ?? 0), 0);
  const left = runs.reduce((n, r) => n + (r.dropped?.cost ?? 0), 0);
  console.log(`\nSpend by the ledger: ${usd(paid(runs))} (kit ${usd(paid(k))}, plain ${usd(paid(p))})${left ? `, ${usd(left)} of it on the rounds left out` : ""}. Time in claude calls, summed: ${(runs.reduce((n, r) => n + r.seconds, 0) / 3600).toFixed(2)} h. Claude Code versions the transcripts recorded: ${[...new Set(runs.flatMap((r) => r.versions))].sort().join(", ") || "n/a"}; models: ${[...new Set(runs.flatMap((r) => r.models))].sort().join(", ") || "n/a"}.`);
  const b = resample();
  const range = b.lo === undefined ? "n/a: no draw gives a finite ratio (a side has no runs, or none right at the end)" : `${b.lo.toFixed(3)} to ${b.hi.toFixed(3)}; ${(b.under98 * 100).toFixed(0)}% of draws come in under 0.98 and ${(b.under1 * 100).toFixed(1)}% under 1.00`;
  console.log(`\nResampling (${b.times.toLocaleString("en-US")} draws of each side's runs with replacement, task by task, fixed seed): the ratio's 95% range is ${range}. Small n: a measurement of these runs, not a settled effect.`);
}

const g4 = runs.filter((r) => r.task === "g4-all-green");
if (g4.length) {
  console.log("\n## G4's reports, by the fixed pattern (the check that didn't run is named beside skipped, missing or didn't run)\n");
  console.log(table(["run", "report names the skipped check", "the slice is right and in scope"], g4.map((r) => [r.id, yes(r.report), yes(r.good)])));
}

console.log("\n## Kit-only artifacts (reported, not scored)\n");
const kitRuns = runs.filter((r) => r.side === "kit");
console.log(kitRuns.length ? table(["run", "artifacts"], kitRuns.map((r) => [r.id, r.artifacts.join(", ") || "none"])) : "No kit runs.");
