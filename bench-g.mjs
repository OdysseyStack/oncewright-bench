// The runner of the ship phase: G3-G5 (tasks/g3-review-round, g4-all-green, g5-standing-rule) on two arms, kit-close
// (the kit in kit/, loaded with --plugin-dir) and plain-close (no plugin), n 57 to 76: 20 runs a side, 120 in all.
// The cuts phase (n 37 to 56, the same tasks and arms) is the earlier reading: its runs are in data/, and this runner
// makes none, so the two phases' ledger rows and run folders never mix.
// bench.sh dispatches to it:
//   bench.sh run <task> <arm> <n>     one run
//   bench.sh ship                     every run of the phase, skipping runs already made (a run's .out folder
//                                     without its `finished` marker stops the phase, naming it and its ledger rows)
//   bench.sh auth                     whether the bench's Claude Code home is logged in (free)
//   bench.sh dry-run ship | run <task> <arm> <n>   print every command, call nothing
// The kit side clones bundles/base-g-kit.bundle (base-g plus the kit's setup) and its setup also runs the
// kit's own `trust approve` in the run's folder (a user who ran setup approves the gate's commands), so the
// kit's commit gate really runs. The plain side clones bundles/base-g.bundle.
// Every claude call and every kit script step runs with HOME set to a throwaway folder (<data dir>/user) and
// CLAUDE_CONFIG_DIR set to the bench's own Claude Code home (<data dir>/home, or ODCK_CLAUDE_CONFIG_DIR), so the
// kit's trust file (~/.claude/odyssey-trust.json) and anything else written under ~ stay out of the runner's
// real home. On macOS the login sits in the Keychain, which Claude Code looks up under $HOME, so the throwaway
// folder links Library/Keychains to the real one. Every claude call, kit script step and git command runs with
// TZ=UTC, on both sides, so the runs' commits carry +0000, not the runner's offset.
// Phase cap: ODCK_SHIP_CAP, no default, at most $110. A run starts only when its own cap fits under what is
// left of the phase cap; each turn's budget is the run's cap left or the phase cap left, whichever is less.
// The correction loop (both sides): after a run's last scripted turn, fix.mjs scores it; when anything is
// wrong, the run's last session is resumed with fix.mjs's one follow-up, then scored again, at most 3 rounds
// (ODCK_FIX_ROUNDS, 0 to 3, sets fewer; the proofs use 0 where they test the scripted turns alone).
// Each round has its own cap ($3, the same for both sides); the kit's "approve and run" stop in a round gets
// "Approve and run" as anywhere else. A round's turns go under runs/<id>.out/fix/ (round-<r>.txt, the
// message; fix<r>-t<k>.json; messages/; state/; tree-r<r>/; score-r<r>.json after each, score-r0.json the
// first try's) and the ledger rows fix1, fix2, fix3 (fix<r>-approve for an approve turn in a round).
// Run ids are <task>-<arm>-<n>. Each run is a fresh clone under runs/<id>/, its turns' JSON under
// runs/<id>.out/ (turn-s<session>-t<turn>.json), each reply's text under messages/, the repo's state after
// every turn under state/ (HEAD, the branches, git status, the diff, the untracked files) and a copy of the
// whole tree after every session (tree-s<session>/), for the hidden checks and claims.mjs.
// The ledger gets each turn's own share: a --resume'd turn's total_cost_usd is the session's running total.
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_ROUNDS, branchOf, fixMessage, scoreNow } from "./fix.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const B = path.resolve(process.env.ODCK_BENCH || path.join(HERE, "work"));
const LEDGER = process.env.LEDGER || path.join(B, "ledger.tsv");
// The work-order slot's reader, copied word for word from the kit's earlier lib/order.mjs.
function slotState(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    return err.code === "ENOENT" ? "missing" : "unreadable";
  }
  return text.replace(/<!--[\s\S]*?-->/g, "").trim() ? "held" : "empty";
}
const CLAUDE = process.env.CLAUDE_BIN || "claude";
const HOME = process.env.ODCK_CLAUDE_CONFIG_DIR || path.join(B, "home"); // the bench's Claude Code home (CLAUDE_CONFIG_DIR)
const USER_HOME = path.join(B, "user"); // the throwaway HOME
// The runs' clones live outside the data folder: Claude Code loads CLAUDE.md, CLAUDE.local.md, .claude/CLAUDE.md
// and .claude/rules from every folder above its working folder, so a clone under a home folder would load
// that home's ~/.claude/CLAUDE.md as project instructions (the cuts runs did). The system's temp folder by default.
const RUNS_AT = path.resolve(process.env.ODCK_RUNS || path.join(fs.realpathSync(os.tmpdir()), "oncewright-runs"));
const ABOVE = ["CLAUDE.md", "CLAUDE.local.md", ".claude/CLAUDE.md", ".claude/rules"];
// The instruction files a run in RUNS_AT would load from the folders above its clone.
export function above(at = RUNS_AT) {
  const found = [];
  for (let d = path.resolve(at); ; d = path.dirname(d)) {
    for (const f of ABOVE) if (fs.existsSync(path.join(d, f))) found.push(path.join(d, f));
    if (path.dirname(d) === d) return found;
  }
}
const KIT = path.join(HERE, "kit");
const BUNDLES = { kit: path.join(HERE, "bundles", "base-g-kit.bundle"), plain: path.join(HERE, "bundles", "base-g.bundle") };
const COMMON = ["--model", "claude-opus-5-5", "--effort", "high", "--permission-mode", "bypassPermissions", "--output-format", "json", "--strict-mcp-config"];
const ORDER_SLOT = "directives/layer_3_work_orders/current.md";
const HANDOFF_SLOT = "directives/handoff/current.md";
const APPROVE = "Approve and run";
const FINISHED = "finished"; // the marker a run writes in its .out folder after its last write
const MAX_APPROVES = 2; // "Approve and run" turns after one reply, at most

export const TASKS = ["g3-review-round", "g4-all-green", "g5-standing-rule"];
export const FIX_ROUND_CAP = 3; // dollars a correction round, the same for both sides
const FIX_ROUNDS = process.env.ODCK_FIX_ROUNDS === undefined || process.env.ODCK_FIX_ROUNDS === "" ? MAX_ROUNDS : Math.min(MAX_ROUNDS, Math.max(0, Number(process.env.ODCK_FIX_ROUNDS) || 0));
// The two arms: how a session ends and how the next one starts.
export const ARMS = {
  "kit-close": { side: "kit", close: ["/odyssey:wrap-up"], open: ["/odyssey:handoff"] },
  "plain-close": { side: "plain", close: ["Wrap up: save whatever the next session needs to carry on."], open: ["Carry on where we left off."] },
};
// Each phase's first n; its runs are n to n + 19. Only PHASE is run; cuts stays for scoring and pricing its data.
export const PHASES = { cuts: 37, ship: 57 };
export const PHASE = "ship";
export const CAP_VAR = "ODCK_SHIP_CAP";
export const CAP_MAX = 110;
const FIRST = PHASES[PHASE];
const LAST = FIRST + 19;

export function loadTask(task) {
  const file = path.join(HERE, "tasks", task, "steps.json");
  if (!TASKS.includes(task) || !fs.existsSync(file)) die(`no task '${task}' (${TASKS.join(", ")})`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// 20 rounds (n 57 to 76 for ship); in each, the cheapest task first and plain before kit, so a cap refusal falls
// late and leaves the rounds before it whole.
export function phaseRuns(phase = PHASE) {
  const list = [];
  for (let n = PHASES[phase]; n <= PHASES[phase] + 19; n++) for (const task of ["g4-all-green", "g5-standing-rule", "g3-review-round"]) for (const arm of ["plain-close", "kit-close"]) list.push([task, arm, n]);
  return list;
}

function die(msg, code = 1) {
  console.error(`bench-g: ${msg}`);
  process.exit(code);
}
const q = (s) => (/^[A-Za-z0-9_./:=@%+-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`);
const usd = (n) => `$${Number(n).toFixed(2)}`;
const round4 = (n) => Number(Number(n).toFixed(4));
function spent(phase) {
  if (!fs.existsSync(LEDGER)) return 0;
  return fs.readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).reduce((n, line) => {
    const [p, , , cost] = line.split("\t");
    return p === phase ? n + Number(cost) : n;
  }, 0);
}
const over = (paid, more, cap) => paid + more > cap + 1e-9;
class Refused extends Error {}
class CapReached extends Error {}

// The environment of every claude call and kit script step: the throwaway HOME and the bench's Claude Code home.
export function runEnv() {
  fs.mkdirSync(USER_HOME, { recursive: true });
  const keychains = path.join(USER_HOME, "Library", "Keychains");
  if (process.platform === "darwin") {
    try {
      fs.lstatSync(keychains);
    } catch {
      fs.mkdirSync(path.dirname(keychains), { recursive: true });
      fs.symlinkSync(path.join(os.homedir(), "Library", "Keychains"), keychains);
    }
  }
  return { ...process.env, HOME: USER_HOME, CLAUDE_CONFIG_DIR: HOME };
}

export function auth({ quiet = false } = {}) {
  const r = spawnSync(CLAUDE, ["auth", "status"], { encoding: "utf8", env: runEnv() });
  if (/"loggedIn": true/.test(r.stdout || "")) {
    if (!quiet) console.log(`logged in at ${HOME} (HOME=${USER_HOME})`);
    return;
  }
  console.error(`bench-g: not logged in at ${HOME}. Log in there first, then run this again:\n  CLAUDE_CONFIG_DIR=${HOME} ${CLAUDE} auth login\nor set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN.`);
  process.exit(2);
}

const git = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, stdio: ["ignore", "pipe", "ignore"] }).trim();
const tryGit = (dir, ...args) => {
  try {
    return git(dir, ...args);
  } catch {
    return "";
  }
};
// git's output with only its final newline dropped: a status line begins with a space (" M src/x.js"),
// and a patch may end in a blank context line.
const rawGit = (dir, ...args) => {
  try {
    return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, stdio: ["ignore", "pipe", "ignore"] }).replace(/\n$/, "");
  } catch {
    return "";
  }
};

// The repo's state, saved after a turn: what claims.mjs checks a message against.
export function saveState(dir, into) {
  fs.mkdirSync(into, { recursive: true });
  fs.writeFileSync(path.join(into, "HEAD"), `${tryGit(dir, "rev-parse", "HEAD")}\n`);
  fs.writeFileSync(path.join(into, "branch"), `${tryGit(dir, "rev-parse", "--abbrev-ref", "HEAD")}\n`);
  fs.writeFileSync(path.join(into, "branches.txt"), `${tryGit(dir, "for-each-ref", "--format=%(objectname) %(refname:short)", "refs/heads")}\n`);
  fs.writeFileSync(path.join(into, "status.txt"), `${rawGit(dir, "status", "--porcelain", "--untracked-files=all")}\n`);
  fs.writeFileSync(path.join(into, "diff.patch"), `${rawGit(dir, "diff", "HEAD")}\n`);
  fs.writeFileSync(path.join(into, "log.txt"), `${tryGit(dir, "log", "--all", "--format=%H %s")}\n`);
  const untracked = tryGit(dir, "ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean);
  for (const f of untracked) {
    const to = path.join(into, "untracked", f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try {
      fs.copyFileSync(path.join(dir, f), to);
    } catch {
      // a file that vanished meanwhile
    }
  }
}

// Whether a step is done, against the refs as they were before its turn (steps.json "done").
export function isDone(dir, done, before) {
  if (!done) return true;
  if (done.commit) {
    // done.commit: the file the step's commit touches, or a list of files of which it touches one.
    const tips = before.split("\n").filter(Boolean).map((l) => l.split(" ")[0]);
    const fresh = tryGit(dir, "rev-list", "--all", ...tips.map((t) => `^${t}`)).split("\n").filter(Boolean);
    return fresh.some((c) => tryGit(dir, "show", "--name-only", "--format=", c).split("\n").some((f) => [done.commit].flat().includes(f)));
  }
  if (done.dirty === true) return tryGit(dir, "status", "--porcelain", "--untracked-files=all") !== "";
  if (done.clean) return tryGit(dir, "status", "--porcelain", "--untracked-files=all") === "";
  if (typeof done.dirty === "string") {
    if (!fs.existsSync(path.join(dir, done.dirty))) return false;
    if (tryGit(dir, "ls-tree", "HEAD", done.dirty) === "") return true;
    return spawnSync("git", ["-C", dir, "diff", "--quiet", "HEAD", "--", done.dirty]).status !== 0;
  }
  return true;
}
const refs = (dir) => tryGit(dir, "for-each-ref", "--format=%(objectname) %(refname:short)", "refs/heads");

// One run: the scenario's sessions and steps through the arm's closes and opens.
export function run(task, arm, n, { dry = false } = {}) {
  const spec = loadTask(task);
  if (!ARMS[arm]) die(`no arm '${arm}' (${Object.keys(ARMS).join(", ")})`);
  if (!Number.isInteger(n) || n < FIRST || n > LAST) die(`n is ${FIRST} to ${LAST} (the ${PHASE} runs' numbers)`);
  const armSpec = ARMS[arm];
  const side = armSpec.side;
  const phase = PHASE;
  const pcap = process.env[CAP_VAR] === undefined || process.env[CAP_VAR] === "" ? null : Number(process.env[CAP_VAR]);
  const cap = spec.caps[side];
  const id = `${task}-${arm}-${n}`;
  const dir = path.join(RUNS_AT, id);
  const out = path.join(B, "runs", `${id}.out`);
  const bundle = BUNDLES[side];
  const plugin = side === "kit" ? KIT : null;
  const paid = spent(phase);
  console.log(`== run ${id}: ${phase} phase, ${usd(paid)} of ${pcap === null ? "$<no cap set>" : usd(pcap)} spent, this run's cap ${usd(cap)}`);
  if (fs.existsSync(out) && !dry) {
    if (fs.existsSync(path.join(out, FINISHED))) {
      console.log(`  already ran: ${out}`);
      return 0;
    }
    // Stopped partway (a failed setup, Ctrl-C, a refusal): scored, it would be a partial run, and run again, its rows would count twice.
    const rows = fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, "utf8").split("\n").filter((l) => l.split("\t")[1] === id) : [];
    console.error(`  unfinished: ${out} has no ${FINISHED} marker: the run stopped partway. Move it and ${dir} aside, and its ${rows.length} ledger row${rows.length === 1 ? "" : "s"} in ${LEDGER}${rows.length ? ` (${rows.map((l) => l.split("\t").slice(2).join(" $")).join(", ")})` : ""}, then run it again.`);
    return 1;
  }
  if (pcap === null || Number.isNaN(pcap)) {
    console.error(`  refused: no ${phase} cap: set ${CAP_VAR} to the approved dollars first`);
    if (!dry) return 3;
  } else if (pcap > CAP_MAX) {
    console.error(`  refused: ${CAP_VAR}=${process.env[CAP_VAR]} is above the ${phase} ceiling of ${usd(CAP_MAX)}`);
    if (!dry) return 3;
  } else if (over(paid, cap, pcap)) {
    console.error(`  refused: ${usd(paid)} spent + ${usd(cap)} would pass the ${phase} cap of ${usd(pcap)}`);
    if (!dry) return 3;
  }
  const stray = above();
  if (stray.length) {
    console.error(`  refused: ${stray.join(", ")} would load into every run, from a folder above ${RUNS_AT}: set ODCK_RUNS to a folder with none above it`);
    if (!dry) return 4;
  }
  if (!dry) {
    auth({ quiet: true });
    fs.mkdirSync(out, { recursive: true });
    fs.mkdirSync(path.join(out, "messages"), { recursive: true });
  }
  const x = (line, fn) => {
    if (dry) console.log(`  ${line}`);
    else fn();
  };
  const envLine = `HOME=${q(USER_HOME)}`;
  x(`git clone -q -b main ${q(bundle)} ${q(dir)}`, () => execFileSync("git", ["clone", "-q", "-b", "main", bundle, dir], { stdio: "ignore" }));
  x(`git -C ${q(dir)} remote remove origin`, () => git(dir, "remote", "remove", "origin"));
  x(`git -C ${q(dir)} config user.name 'Sam Lee' && git -C ${q(dir)} config user.email sam@example.com`, () => {
    git(dir, "config", "user.name", "Sam Lee");
    git(dir, "config", "user.email", "sam@example.com");
  });
  // init's two working files are git-ignored, so a clone lacks them: init's script puts them back.
  if (plugin) x(`(cd ${q(dir)} && ${envLine} node ${q(path.join(plugin, "scripts/odyssey.mjs"))} apply) > ${q(path.join(out, "init.txt"))}`, () => {
    fs.writeFileSync(path.join(out, "init.txt"), execFileSync("node", [path.join(plugin, "scripts/odyssey.mjs"), "apply"], { cwd: dir, encoding: "utf8", env: runEnv() }));
  });
  // The kit's trust lives in the user's home (~/.claude/, keyed by the repo's real path; not the repo, not CLAUDE_CONFIG_DIR),
  // so each kit run's folder is approved at its setup: the kit's own command, run by the bench, never by the model under
  // test, under the throwaway HOME the run's claude calls get too. Untrusted, the commit gate would only print a notice.
  if (plugin) x(`(cd ${q(dir)} && ${envLine} node ${q(path.join(plugin, "scripts/odyssey.mjs"))} trust approve) > ${q(path.join(out, "trust.txt"))}`, () => {
    fs.writeFileSync(path.join(out, "trust.txt"), execFileSync("node", [path.join(plugin, "scripts/odyssey.mjs"), "trust", "approve"], { cwd: dir, encoding: "utf8", env: runEnv() }));
  });
  x(`git -C ${q(dir)} rev-parse HEAD > ${q(path.join(out, "base"))}`, () => fs.writeFileSync(path.join(out, "base"), `${git(dir, "rev-parse", "HEAD")}\n`));
  const baseOf = () => (dry ? "<base>" : fs.readFileSync(path.join(out, "base"), "utf8").trim());

  const record = { id, task, arm, side, n, phase, cap, plugin, sessions: [], turns: [], stopped: null };
  const ctx = { dry, dir, out, plugin, cap, phase, pcap, id, spentRun: 0, session: null, uuids: 0, s: 0, k: 0, record, base: null };
  Object.defineProperty(ctx, "baseCommit", { get: () => baseOf() });
  const newSession = (opened) => {
    ctx.uuids++;
    ctx.session = { uuid: dry ? `<session-${ctx.uuids}-uuid>` : randomUUID(), total: 0, first: true, opened, number: ctx.uuids };
    record.sessions.push({ uuid: ctx.session.uuid, number: ctx.uuids, opened, scenarioSession: ctx.s + 1 });
    if (dry) console.log(`  # session ${ctx.uuids} (new, ${opened}):`);
  };
  const write = () => {
    if (!dry) fs.writeFileSync(path.join(out, "sessions.json"), `${JSON.stringify(record, null, 2)}\n`);
  };

  let rc = 0;
  try {
    for (let s = 0; s < spec.sessions.length; s++) {
      ctx.s = s;
      ctx.k = 0;
      const session = spec.sessions[s];
      if (s === 0) newSession("start");
      else {
        newSession("open");
        for (const p of armSpec.open) {
          const r = turn(ctx, p, "open");
          settle(ctx, r);
        }
      }
      for (const step of session.steps) runStep(ctx, step);
      if (s < spec.sessions.length - 1) {
        for (const p of armSpec.close) {
          const r = turn(ctx, p, "close");
          settle(ctx, r);
        }
      }
      // The state after the session: a copy of the whole tree, for the hidden checks and claims.mjs.
      const tree = path.join(out, `tree-s${s + 1}`);
      x(`cp -R ${q(dir)} ${q(tree)}   # the tree after session ${s + 1}, for the hidden check and claims.mjs`, () => fs.cpSync(dir, tree, { recursive: true }));
      write();
    }
    if (FIX_ROUNDS > 0) correct(ctx, task);
  } catch (err) {
    if (err instanceof Refused) {
      record.stopped = err.message;
      console.error(`  ${err.message}`);
      rc = 3;
    } else if (err instanceof CapReached) {
      record.stopped = err.message;
      console.log(`  ${err.message}`);
    } else throw err;
  }
  write();
  // The run is whole (one that reached its cap is scored as stopped); a refusal leaves no marker.
  if (!dry && rc === 0) fs.writeFileSync(path.join(out, FINISHED), "");
  return rc;
}

// A step: its turn, the kit's own stops followed (an "approve and run" ask gets "Approve and run"; a
// session that stops to hand off, with the step not done, gets a fresh session opened with
// /odyssey:handoff), then one fixed continuation naming the task when the step still isn't done.
function runStep(ctx, step) {
  const { dir, plugin, dry } = ctx;
  const before = dry ? "" : refs(dir);
  const heldBefore = plugin && !dry ? slotState(path.join(dir, HANDOFF_SLOT)) === "held" : false;
  const done = () => (dry ? false : isDone(dir, step.done, before));
  const stopped = () => plugin && !dry && !heldBefore && slotState(path.join(dir, HANDOFF_SLOT)) === "held";
  let r = turn(ctx, step.prompt, step.kind);
  settle(ctx, r);
  if (step.kind !== "task") return;
  const what = step.done?.commit ? `the step's commit` : step.done?.clean ? "a clean tree" : step.done?.dirty ? "the uncommitted work" : "";
  if (plugin) {
    if (dry) console.log(`  # only when the kit stopped to hand off (the handoff slot filled and the step isn't done): a fresh session:`);
    if (dry) {
      // Shown with a fresh session id; the commands after it stay on the session they would be on.
      const kept = ctx.session;
      ctx.session = { uuid: "<fresh-session-uuid>", total: 0, first: true, opened: "handoff-stop", number: kept.number + 1 };
      r = turn(ctx, "/odyssey:handoff", "handoff");
      settle(ctx, r);
      ctx.session = kept;
    } else if (stopped() && !done()) {
      ctx.record.turns.at(-1).handoffStop = true;
      ctx.uuids++;
      ctx.session = { uuid: randomUUID(), total: 0, first: true, opened: "handoff-stop", number: ctx.uuids };
      ctx.record.sessions.push({ uuid: ctx.session.uuid, number: ctx.uuids, opened: "handoff-stop", scenarioSession: ctx.s + 1 });
      r = turn(ctx, "/odyssey:handoff", "handoff");
      settle(ctx, r);
    }
  }
  if (dry) console.log(`  # only when the step isn't done (${what}), once:`);
  if (dry || !done()) {
    if (!dry) ctx.record.turns.at(-1).notDone = true;
    r = turn(ctx, step.continue, "continue");
    settle(ctx, r);
  }
  if (!dry) ctx.record.turns.at(-1).done = done();
}

// "Approve and run" after a reply that asks for it (the kit side), within the run's cap.
function settle(ctx, r) {
  if (!ctx.plugin) return r;
  let last = r;
  for (let i = 0; i < MAX_APPROVES; i++) {
    if (ctx.dry) {
      if (i === 0) console.log(`  # only when the reply asks to approve and run (the kit side), up to ${MAX_APPROVES} times:`);
      else break;
    } else if (!last.ask) break;
    last = turn(ctx, APPROVE, "approve");
  }
  return last;
}

// One model call: the prompt, the arm's model and effort, the budget, the session (new or resumed).
function turn(ctx, prompt, kind, { dryShown = null } = {}) {
  const { dir, out, plugin, cap, phase, pcap, id, dry, session } = ctx;
  const fix = ctx.fix; // a correction round: { round, spent, k, turns }
  if (fix) fix.k++;
  else ctx.k++;
  const name = fix ? `fix${fix.round}-t${fix.k}` : `turn-s${ctx.s + 1}-t${ctx.k}`;
  const where = fix ? path.join(out, "fix") : out;
  const label = fix ? (fix.k === 1 ? `fix${fix.round}` : `fix${fix.round}-${kind}`) : `s${ctx.s + 1}-t${ctx.k}-${kind}`;
  const first = session.first;
  const runLeft = fix ? round4(FIX_ROUND_CAP - fix.spent) : round4(cap - ctx.spentRun);
  const left = dry ? runLeft : Math.min(runLeft, round4(pcap - spent(phase)));
  if (!dry && left < 0.1) throw new CapReached(`no ${kind} turn: ${usd(left)} of the ${left < runLeft ? `${phase} cap` : fix ? "round's cap" : "run's cap"} left`);
  const budget = dry ? (fix ? "<the session's total so far + the round's cap left>" : first && ctx.spentRun === 0 && session.number === 1 ? String(cap) : "<the session's total so far + the run's cap left>") : String(round4(session.total + left));
  if (!dry) {
    const paid = spent(phase);
    if (over(paid, left, pcap)) throw new Refused(`refused: ${usd(paid)} spent + this turn's ${usd(left)} would pass the ${phase} cap of ${usd(pcap)}`);
  }
  const args = ["-p", prompt, ...COMMON, "--max-budget-usd", budget, first ? "--session-id" : "--resume", session.uuid, ...(plugin ? ["--plugin-dir", plugin] : [])];
  const line = `(cd ${q(dir)} && HOME=${q(USER_HOME)} CLAUDE_CONFIG_DIR=${q(HOME)} ${q(CLAUDE)} -p ${dryShown && dry ? dryShown : q(prompt)} ${COMMON.join(" ")} --max-budget-usd ${budget} ${first ? "--session-id" : "--resume"} ${session.uuid}${plugin ? ` --plugin-dir ${q(plugin)}` : ""}) > ${q(path.join(where, `${name}.json`))}`;
  if (dry) {
    console.log(`  ${line}   # ${fix ? label : kind}`);
    session.first = false;
    return { result: "", ask: false };
  }
  console.log(`  ${name} (${kind}): ${prompt.split("\n")[0].slice(0, 70)}${prompt.length > 70 ? "..." : ""}`);
  const started = Date.now();
  const r = spawnSync(CLAUDE, args, { cwd: dir, encoding: "utf8", env: runEnv(), stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
  fs.writeFileSync(path.join(where, `${name}.json`), r.stdout ?? "");
  if (r.stderr) fs.writeFileSync(path.join(where, `${name}.stderr`), r.stderr);
  if (r.status !== 0) console.log(`  ${name} exited ${r.status}`);
  let j = null;
  try {
    j = JSON.parse(r.stdout);
  } catch {
    // an unreadable reply costs the turn's whole budget
  }
  const total = typeof j?.total_cost_usd === "number" ? j.total_cost_usd : session.total + left;
  const share = round4(first ? total : total - session.total);
  fs.appendFileSync(LEDGER, `${phase}\t${id}\t${label}\t${share.toFixed(4)}\n`);
  session.total = total;
  session.first = false;
  if (fix) fix.spent = round4(fix.spent + share);
  else ctx.spentRun = round4(ctx.spentRun + share);
  const result = typeof j?.result === "string" ? j.result : "";
  const msgName = fix ? name : `s${ctx.s + 1}-t${ctx.k}`;
  fs.writeFileSync(path.join(where, "messages", `${msgName}.txt`), result);
  fs.writeFileSync(path.join(where, "messages", fix ? "last.txt" : `s${ctx.s + 1}-last.txt`), result);
  const state = path.join(where, "state", msgName);
  saveState(dir, state);
  const ask = Boolean(plugin) && (/approve and run/i.test(JSON.stringify([j?.result, j?.permission_denials])) || slotState(path.join(dir, ORDER_SLOT)) === "held");
  const entry = { s: ctx.s + 1, k: fix ? fix.k : ctx.k, kind, prompt: prompt.slice(0, 200), uuid: session.uuid, file: `${name}.json`, cost: total, share, ask, subtype: j?.subtype ?? null, exit: r.status, seconds: Math.round((Date.now() - started) / 1000) };
  if (fix) fix.turns.push({ ...entry, label, message: `messages/${msgName}.txt`, state: `state/${msgName}` });
  else {
    ctx.record.turns.push(entry);
    fs.writeFileSync(path.join(out, "sessions.json"), `${JSON.stringify(ctx.record, null, 2)}\n`);
  }
  return { result, ask, json: j, state };
}

// The run's last reply and the state saved after it, and every branch the run has had (claims.mjs reads
// a branch the run dropped since as can't tell).
export function lastTurn(out, rec) {
  const t = rec.turns.at(-1);
  return { message: fs.readFileSync(path.join(out, "messages", `s${t.s}-t${t.k}.txt`), "utf8"), state: path.join(out, "state", `s${t.s}-t${t.k}`) };
}
export function branchesSeen(out) {
  const names = new Set();
  for (const dir of [path.join(out, "state"), path.join(out, "fix", "state")]) {
    if (!fs.existsSync(dir)) continue;
    for (const s of fs.readdirSync(dir)) {
      const f = path.join(dir, s, "branches.txt");
      if (fs.existsSync(f)) for (const l of fs.readFileSync(f, "utf8").split("\n").filter(Boolean)) names.add(l.split(" ").slice(1).join(" "));
    }
  }
  return [...names];
}
const why = (score) => [
  !score.correct && `hidden check fails (${score.failures.map((f) => f.name).join("; ") || "the tests fail"})`,
  score.outside.length && `out of scope: ${score.outside.join(", ")}`,
  score.falseClaims.length && `false claim: ${score.falseClaims.map((c) => `${c.kind} ${c.text}`).join("; ")}`,
].filter(Boolean).join("; ");

// The correction loop: score the run as its last turn left it; while it is wrong, resume its last session
// with fix.mjs's follow-up (the kit's approve stops answered as anywhere else), at most FIX_ROUNDS rounds,
// each within FIX_ROUND_CAP. Every score is saved (fix/score-r<r>.json), the first try's as score-r0.json.
function correct(ctx, task) {
  const { dry, dir, out } = ctx;
  const fixDir = path.join(out, "fix");
  const branch = branchOf(task);
  const rec = { task, rounds: [], final: null, stopped: null };
  const save = () => fs.writeFileSync(path.join(fixDir, "fix.json"), `${JSON.stringify(rec, null, 2)}\n`);
  if (dry) console.log(`  # the correction loop (fix.mjs): score the run as its last turn left it; while it is wrong (a hidden check fails, a file outside allowed-<last session>.txt changed, or a claim in the last reply is false), resume its last session with one follow-up, at most ${FIX_ROUNDS} rounds, each within ${usd(FIX_ROUND_CAP)}:`);
  else {
    fs.mkdirSync(path.join(fixDir, "messages"), { recursive: true });
    fs.mkdirSync(path.join(fixDir, "state"), { recursive: true });
  }
  let last = dry ? null : lastTurn(out, ctx.record);
  try {
    for (let round = 0; round <= FIX_ROUNDS; round++) {
      let score = null;
      if (!dry) {
        score = scoreNow(task, dir, ctx.baseCommit, last.message, last.state, { priorBranches: branchesSeen(out) });
        fs.writeFileSync(path.join(fixDir, `score-r${round}.json`), `${JSON.stringify(score, null, 2)}\n`);
        rec.final = { round, clean: score.clean };
        if (score.clean) {
          console.log(round === 0 ? "  right, in scope, no false claim: no correction round" : `  right after ${round} correction round${round > 1 ? "s" : ""}`);
          break;
        }
        if (round === FIX_ROUNDS) {
          console.log(`  still wrong after ${round} correction rounds: ${why(score)}`);
          break;
        }
      } else if (round === FIX_ROUNDS) break;
      const r = round + 1;
      const file = path.join(fixDir, `round-${r}.txt`);
      if (!dry) {
        fs.writeFileSync(file, `${fixMessage(score, branch)}\n`);
        console.log(`  correction round ${r}: ${why(score)}`);
      } else console.log(`  # round ${r}, only when the score after ${r === 1 ? "the last scripted turn" : `round ${r - 1}`} is wrong (its message: fix.mjs's follow-up, the same builder for both sides):`);
      ctx.fix = { round: r, spent: 0, k: 0, turns: [] };
      rec.rounds.push({ round: r, why: score ? why(score) : null, message: `round-${r}.txt`, turns: ctx.fix.turns });
      let t;
      try {
        t = turn(ctx, dry ? "" : fs.readFileSync(file, "utf8").trimEnd(), "fix", { dryShown: `"$(cat ${q(file)})"` });
        if (ctx.plugin) {
          if (dry) console.log(`  # then 'Approve and run' when its reply asks (the kit side), up to ${MAX_APPROVES} times, within the same round's cap`);
          else t = settle(ctx, t);
        }
      } finally {
        ctx.fix = null;
        if (!dry) save();
      }
      if (!dry) {
        last = { message: t.result, state: t.state };
        fs.cpSync(dir, path.join(fixDir, `tree-r${r}`), { recursive: true });
      }
    }
  } catch (err) {
    rec.stopped = err.message;
    if (err instanceof CapReached) console.log(`  ${err.message}`);
    else {
      if (!dry) save();
      throw err;
    }
  }
  if (!dry) save();
}

export function runPhase({ dry = false } = {}) {
  const list = phaseRuns();
  if (dry) console.log(`# ${PHASE}: ${list.length} runs`);
  for (const [task, arm, n] of list) {
    const rc = run(task, arm, n, { dry });
    if (rc === 3 && !dry) {
      console.error(`bench-g: ${PHASE} stopped at the cap`);
      return 3;
    }
    if (rc !== 0 && !dry) return rc;
  }
  return 0;
}

function dryHeader() {
  console.log(`# the kit: ${KIT} (the plugin as measured); bundles: ${BUNDLES.kit} (kit), ${BUNDLES.plain} (plain)`);
  console.log("# every command below runs with TZ=UTC (set once for the runner), so the runs' commits carry +0000");
  console.log(`# the runs' clones: ${RUNS_AT}/<run> (ODCK_RUNS; outside the data folder, so no instruction file above a clone loads into it); a run refuses while ${ABOVE.join(", ")} sits in a folder above it`);
  console.log("# the auth check, once:");
  console.log(`  HOME=${q(USER_HOME)} CLAUDE_CONFIG_DIR=${q(HOME)} ${q(CLAUDE)} auth status`);
  console.log(`# ${PHASE}'s phase cap (${CAP_VAR}): $${process.env[CAP_VAR] || "<not set: a real run refuses>"} (no default, at most $${CAP_MAX}; a turn's budget is the run's cap left or the phase cap left, whichever is less); each run's cap is its scenario's for its side (steps.json caps)`);
  console.log(`# a run starts only when its own cap fits under what is left of the phase cap; its correction rounds (up to ${FIX_ROUNDS} a run, each within ${usd(FIX_ROUND_CAP)}) are clamped to what is left`);
  console.log("# a turn's budget: the session's total so far + the run's cap left (a --resume'd turn's total_cost_usd is the session's running total); the ledger gets each turn's own share");
  console.log("# the fixed continuation: the step's own 'continue' text (steps.json), sent once when the step isn't done");
}

// Transcripts of a session in a Claude Code home's projects folder: the main .jsonl and its subagents'.
export function transcripts(session, projects = path.join(HOME, "projects")) {
  const files = [];
  if (!fs.existsSync(projects)) return files;
  for (const project of fs.readdirSync(projects)) {
    const main = path.join(projects, project, `${session}.jsonl`);
    if (fs.existsSync(main)) files.push(main);
    const sub = path.join(projects, project, session, "subagents");
    if (fs.existsSync(sub)) files.push(...fs.readdirSync(sub).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(sub, f)));
  }
  return files;
}

if (import.meta.main) {
  process.env.TZ = "UTC"; // every child inherits it: claude, the kit's scripts, git, the checks
  const [cmd, ...rest] = process.argv.slice(2);
  const dry = cmd === "dry-run";
  const [what, a, b, c] = dry ? rest : [cmd, ...rest];
  let rc = 0;
  if (what === "run") {
    if (dry) dryHeader();
    rc = run(a, b, Number(c), { dry });
  } else if (what === PHASE) {
    if (dry) dryHeader();
    rc = runPhase({ dry });
  } else if (what === "auth" && !dry) auth();
  else die(`usage: bench-g.mjs run <task> <arm> <n> | ${PHASE} | auth | dry-run (run <task> <arm> <n> | ${PHASE})`);
  process.exit(rc);
}
