// The launcher (launch.mjs), its Stop hook (hooks/wrap-up-stop.mjs), the status bar's context tap,
// and `odyssey.mjs launcher`. A fake claude stands in for Claude Code: offline, and bounded in time.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HANDOFF, flagBase, launch } from "./launch.mjs";
import { tap } from "./statusline.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(HERE, "..", "hooks", "wrap-up-stop.mjs");
const SCRIPT = path.join(HERE, "odyssey.mjs");
const WIN = process.platform === "win32";
delete process.env.CLAUDE_CONFIG_DIR; // the machine extras follow it; every test here sets its own HOME
const scratch = realpathSync.native(mkdtempSync(path.join(tmpdir(), "odyssey-launch-")));

after(() => {
  assert.ok(scratch.startsWith(realpathSync.native(tmpdir()) + path.sep), "scratch dir is under tmpdir");
  assert.ok(path.basename(scratch).startsWith("odyssey-launch-"), "scratch dir is ours");
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

let dirs = 0;
const fresh = (name) => {
  const dir = path.join(scratch, `${name}-${++dirs}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

// Runs the Stop hook the way Claude Code does. -> its parsed output, or null when it printed nothing.
function stopHook(input, env) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), env: { ...process.env, ...env }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

test("the Stop hook does nothing outside a launched session, asks for wrap-up past the mark once, and hands a finished wrap-up to the launcher", () => {
  const base = path.join(fresh("flags"), "repo");
  const at = (pct, sid = "s1") => writeFileSync(`${base}.ctx`, `${sid} ${pct}\n`);
  const off = { ODYSSEY_LAUNCH: "", ODYSSEY_WRAPUP_PCT: "" };
  const on = { ODYSSEY_LAUNCH: base, ODYSSEY_WRAPUP_PCT: "" };
  at(90);
  assert.equal(stopHook({ session_id: "s1" }, off), null, "a session the launcher didn't start");
  const asked = stopHook({ session_id: "s1", stop_hook_active: false }, on);
  assert.equal(asked.decision, "block");
  assert.match(asked.reason, /90%, past the 35% wrap-up mark/);
  assert.match(asked.reason, /\/odyssey:wrap-up/);
  assert.ok(existsSync(asked.reason.match(/read (\S+SKILL\.md)/)[1]), "it names the wrap-up skill's file");
  assert.equal(stopHook({ session_id: "s1", stop_hook_active: true }, on), null, "never twice in a row");
  assert.equal(stopHook({ session_id: "s2" }, on), null, "another session's percent");
  at(34);
  assert.equal(stopHook({ session_id: "s1" }, on), null, "under the mark");
  assert.match(stopHook({ session_id: "s1" }, { ...on, ODYSSEY_WRAPUP_PCT: "30" }).reason, /34%, past the 30% wrap-up mark/, "the mark the user set");
  rmSync(`${base}.ctx`);
  assert.equal(stopHook({ session_id: "s1" }, on), null, "no status bar: no mark");
  writeFileSync(`${base}.quit`, "");
  assert.equal(stopHook({ session_id: "s1", stop_hook_active: true }, on), null);
  assert.ok(existsSync(`${base}.restart`) && !existsSync(`${base}.quit`), "the quit flag becomes the restart flag");
});

test("the Stop hook holds the relaunch while a background agent, workflow, teammate or shell task runs, and says so", () => {
  const base = path.join(fresh("flags"), "repo");
  const on = { ODYSSEY_LAUNCH: base, ODYSSEY_WRAPUP_PCT: "" };
  writeFileSync(`${base}.ctx`, "s1 90\n");
  writeFileSync(`${base}.quit`, "");
  const agent = { id: "a1", type: "subagent", status: "running", description: "run the benchmark" };
  const held = stopHook({ session_id: "s1", background_tasks: [agent, { id: "m1", type: "monitor", status: "running" }] }, on);
  assert.match(held.systemMessage, /once 1 background task\(s\) finish: run the benchmark/);
  assert.ok(existsSync(`${base}.quit`) && !existsSync(`${base}.restart`), "the relaunch waits");
  assert.equal(held.decision, undefined, "no second wrap-up pass while it waits");
  assert.equal(stopHook({ session_id: "s1", background_tasks: [{ id: "m1", type: "monitor", status: "running" }] }, on), null, "a monitor doesn't hold it");
  assert.ok(existsSync(`${base}.restart`) && !existsSync(`${base}.quit`), "the last agent reported: the relaunch goes");
});

test("the Stop hook drops a quit flag older than 15 minutes that no stop held, so an interrupted wrap-up can't end a later session", () => {
  const base = path.join(fresh("flags"), "repo");
  const on = { ODYSSEY_LAUNCH: base, ODYSSEY_WRAPUP_PCT: "" };
  const hoursAgo = new Date(Date.now() - 6 * 3600e3);
  writeFileSync(`${base}.ctx`, "s1 15\n");
  writeFileSync(`${base}.quit`, "");
  utimesSync(`${base}.quit`, hoursAgo, hoursAgo);
  assert.equal(stopHook({ session_id: "s1" }, on), null);
  assert.ok(!existsSync(`${base}.quit`) && !existsSync(`${base}.restart`), "stale: deleted, no relaunch");
  writeFileSync(`${base}.quit`, "");
  stopHook({ session_id: "s1", background_tasks: [{ id: "a1", type: "subagent", status: "running" }] }, on);
  utimesSync(`${base}.quit`, hoursAgo, hoursAgo);
  stopHook({ session_id: "s1", background_tasks: [] }, on);
  assert.ok(existsSync(`${base}.restart`), "a flag a stop held waits for its agents however long they run");
});

test("the status bar leaves the context percent only in a launched session", () => {
  const base = path.join(fresh("tap"), "repo");
  const data = { session_id: "s1", context_window: { used_percentage: 42 } };
  tap(data, {});
  assert.ok(!existsSync(`${base}.ctx`));
  tap(data, { ODYSSEY_LAUNCH: base });
  assert.equal(readFileSync(`${base}.ctx`, "utf8"), "s1 42\n");
  tap({ session_id: "s1" }, { ODYSSEY_LAUNCH: `${base}-none` });
  assert.ok(!existsSync(`${base}-none.ctx`), "no percent yet, no file");
});

// A stub claude whose script is `body`, with `log` (a file in its folder) and `wrapUp()` (wrap-up's
// last step, then the real Stop hook) in scope.
function stubClaude(body) {
  const dir = fresh("bin");
  const log = path.join(dir, "prompts.log");
  writeFileSync(
    path.join(dir, "fake-claude.mjs"),
    `import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const log = ${JSON.stringify(log)};
const wrapUp = () => {
  writeFileSync(process.env.ODYSSEY_LAUNCH + ".quit", "");
  spawnSync(process.execPath, [${JSON.stringify(HOOK)}], { input: JSON.stringify({ session_id: "s1" }), stdio: ["pipe", "ignore", "inherit"] });
};
${body}
`,
  );
  const bin = path.join(dir, WIN ? "claude.cmd" : "claude");
  writeFileSync(
    bin,
    WIN
      ? `@"${process.execPath}" "%~dp0fake-claude.mjs" %*\r\n`
      : `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake-claude.mjs" "$@"\n`,
    { mode: 0o755 },
  );
  return { bin, log };
}

// A fake claude: logs its prompt; the first session runs wrap-up's last step and the real Stop
// hook, then waits to be ended; the next one exits with 3. It never runs past 5 seconds.
const fakeClaude = () =>
  stubClaude(`const first = !existsSync(log);
appendFileSync(log, process.argv[2] + "\\n");
if (!first) process.exit(3);
wrapUp();
setTimeout(() => process.exit(9), 5000);`);

test("the launcher starts the next session with the handoff after wrap-up, and stops when a session ends without it", async () => {
  const { bin, log } = fakeClaude();
  const root = fresh("repo");
  const home = fresh("home");
  const lines = [];
  const { code, runs } = await launch({ root, prompt: "start here", claude: bin, home, pollMs: 20, graceMs: 50, log: (l) => lines.push(l) });
  assert.deepEqual(readFileSync(log, "utf8").trim().split(/\r?\n/), ["start here", HANDOFF]);
  assert.equal(runs, 2);
  assert.equal(code, 3, "the last session's exit code");
  assert.deepEqual(lines, [`Wrap-up finished: starting the next session with ${HANDOFF}.`]);
  assert.ok(flagBase(root, home).startsWith(path.join(home, ".claude", "odyssey-launch") + path.sep));
  assert.deepEqual(readdirSync(path.join(home, ".claude", "odyssey-launch")), [], "no flag left behind");
});

test("the launcher stops after three sessions in a row that each wrapped up within 5 minutes of starting, and says why", async () => {
  // Every session wraps up at once, as one that starts past the mark would; the fifth exits, so
  // a launcher without the limit still ends.
  const { bin, log } = stubClaude(`appendFileSync(log, "start\\n");
if (readFileSync(log, "utf8").split("\\n").length > 5) process.exit(5);
wrapUp();
setTimeout(() => process.exit(9), 5000);`);
  const lines = [];
  const { runs } = await launch({ root: fresh("repo"), claude: bin, home: fresh("home"), env: { ...process.env, ODYSSEY_WRAPUP_PCT: "35" }, pollMs: 20, graceMs: 50, log: (l) => lines.push(l) });
  assert.equal(runs, 3);
  assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 3, "no fourth session");
  assert.match(lines.at(-1), /3 sessions in a row wrapped up within 5 minutes of starting/);
  assert.match(lines.at(-1), /35%/, "it names the mark");
});

test("the launcher refuses claude's own flags, which later sessions would start without, and names the settings that cover every session", () => {
  const { bin, log } = stubClaude(`appendFileSync(log, process.argv.slice(2).join("|") + "\\n");`);
  const home = fresh("home");
  const env = { ...process.env, HOME: home, USERPROFILE: home, PATH: `${path.dirname(bin)}${path.delimiter}${process.env.PATH}` };
  const r = spawnSync(process.execPath, [path.join(HERE, "launch.mjs"), "--model", "opus", "fix the test"], { cwd: fresh("repo"), env, encoding: "utf8" });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /`--model` is claude's own flag/);
  assert.match(r.stderr, /permissions\.defaultMode/);
  assert.ok(!existsSync(log), "claude never started");
});

test("the launcher refuses a flag anywhere on the line, not only first, and passes a quoted prompt that holds one", () => {
  const { bin, log } = stubClaude(`appendFileSync(log, JSON.stringify(process.argv.slice(2)) + "\\n");`);
  const home = fresh("home");
  const env = { ...process.env, HOME: home, USERPROFILE: home, PATH: `${path.dirname(bin)}${path.delimiter}${process.env.PATH}` };
  const run = (...args) => spawnSync(process.execPath, [path.join(HERE, "launch.mjs"), ...args], { cwd: fresh("repo"), env, encoding: "utf8", timeout: 20000 });
  const late = run("fix", "--model", "x");
  assert.equal(late.status, 2, late.stderr);
  assert.match(late.stderr, /`--model` is claude's own flag/);
  assert.ok(!existsSync(log), "claude never started");
  const quoted = run("use --force here");
  assert.equal(quoted.status, 0, quoted.stderr);
  assert.equal(readFileSync(log, "utf8"), '["use --force here"]\n', "one prompt, flag and all");
});

test("the first session opens with the handoff only when a message or a timer waits, and plain otherwise", async () => {
  const { bin, log } = stubClaude(`appendFileSync(log, JSON.stringify(process.argv.slice(2)) + "\\n");`);
  const root = fresh("repo");
  const slot = path.join(root, "directives", "handoff");
  const opts = { root, claude: bin, home: fresh("home"), pollMs: 20, graceMs: 50 };
  await launch(opts);
  mkdirSync(slot, { recursive: true });
  writeFileSync(path.join(slot, "current.md"), "<!-- Empty: the closing session writes here. -->\n");
  writeFileSync(path.join(slot, "timers.md"), "");
  await launch(opts);
  writeFileSync(path.join(slot, "timers.md"), "## t1 · `0 9 21 11 *`\nCheck the deploy.\n");
  await launch(opts);
  writeFileSync(path.join(slot, "timers.md"), "");
  writeFileSync(path.join(slot, "current.md"), "<!-- Empty: the closing session writes here. -->\nFirst: fix the login bug.\n");
  await launch(opts);
  assert.deepEqual(readFileSync(log, "utf8").trim().split(/\r?\n/), ["[]", "[]", `["${HANDOFF}"]`, `["${HANDOFF}"]`]);
});

test("after wrap-up the launcher gives the session's other Stop hooks 10 seconds before it ends the session", async () => {
  // The first session's own Stop hooks take 4 seconds after wrap-up's flag is handed over.
  const { bin, log } = stubClaude(`const first = !existsSync(log);
appendFileSync(log, "start\\n");
if (!first) process.exit(3);
process.on("SIGTERM", () => { appendFileSync(log, "cut off\\n"); process.exit(0); });
wrapUp();
setTimeout(() => { appendFileSync(log, "hooks done\\n"); process.exit(0); }, 4000);`);
  await launch({ root: fresh("repo"), prompt: "go", claude: bin, home: fresh("home"), pollMs: 20, log: () => {} });
  assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), ["start", "hooks done", "start"]);
});

test("two launchers in one repo keep their own flags: one session's wrap-up leaves the other at work", async () => {
  const root = fresh("repo");
  const home = fresh("home");
  const busy = stubClaude(`setTimeout(() => process.exit(4), 1500);`);
  const opts = { root, home, pollMs: 20, graceMs: 50, log: () => {} };
  const [a, b] = await Promise.all([
    launch({ ...opts, prompt: "A", claude: fakeClaude().bin, id: 1 }),
    launch({ ...opts, prompt: "B", claude: busy.bin, id: 2 }),
  ]);
  assert.deepEqual([a.runs, a.code], [2, 3], "A wrapped up and went on");
  assert.deepEqual([b.runs, b.code], [1, 4], "B finished its own work");
  assert.deepEqual(readdirSync(path.join(home, ".claude", "odyssey-launch")), [], "each removed its own files");
});

test("launcher install writes a command that opens this repo, refuses a taken name, and status and remove know it", () => {
  const home = fresh("home");
  const root = fresh("proj");
  spawnSync("git", ["init", "-q"], { cwd: root });
  const bin = path.join(home, ".local", "bin");
  const env = { ...process.env, HOME: home, USERPROFILE: home, SHELL: "/bin/sh", PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, "launcher", ...args], { cwd: root, env, encoding: "utf8" });
  const real = realpathSync.native(root);

  assert.equal(run("status").stdout, "Launcher: none for this repo.\n");
  const added = run("install", "zq-launch");
  assert.equal(added.status, 0, added.stderr);
  assert.match(added.stdout, /Launcher: added `zq-launch`/);
  const file = path.join(bin, WIN ? "zq-launch.cmd" : "zq-launch");
  const text = readFileSync(file, "utf8");
  assert.ok(text.includes(`odyssey-launcher: ${real}`), text);
  if (!WIN) assert.ok(statSync(file).mode & 0o100, "executable");
  assert.ok(readFileSync(path.join(home, ".claude", "odyssey-launch.mjs")).equals(readFileSync(path.join(HERE, "launch.mjs"))));
  assert.equal(run("status").stdout, "Launcher: `zq-launch`.\n");
  const report = spawnSync(process.execPath, [SCRIPT, "status"], { cwd: root, env, encoding: "utf8" }).stdout;
  assert.match(report, /^Launcher: `zq-launch` opens this repo, and starts the next session after each wrap-up\.$/m);
  assert.match(run("install", "zq-launch").stdout, /was already this repo's/);

  const taken = run("install", "node");
  assert.notEqual(taken.status, 0);
  assert.match(taken.stderr, /`node` is already a command here/);
  writeFileSync(path.join(bin, WIN ? "zq-other.cmd" : "zq-other"), "someone else's\n");
  assert.match(run("install", "zq-other").stderr, /already exists; pick another name/);
  assert.match(run("remove", "zq-other").stderr, /isn't this repo's launcher/);
  assert.match(run("install", "Bad Name").stderr, /lowercase letters, digits and dashes/);

  assert.match(run("remove", "zq-launch").stdout, /Launcher: removed `zq-launch`/);
  assert.ok(!existsSync(file));
  assert.equal(run("status").stdout, "Launcher: none for this repo.\n");
});

test("launcher install decides a name is taken from the shell's answer, not from what a startup file prints", () => {
  if (WIN) return; // a POSIX shell feature; CI counts a skipped test as a failure
  const home = fresh("home");
  const root = fresh("proj");
  spawnSync("git", ["init", "-q"], { cwd: root });
  const banner = path.join(home, "shrc");
  writeFileSync(banner, 'echo "Restored session: ready"\n');
  const bin = path.join(home, ".local", "bin");
  const env = { ...process.env, HOME: home, SHELL: "/bin/sh", ENV: banner, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, "launcher", ...args], { cwd: root, env, encoding: "utf8" });
  const added = run("install", "zq-banner");
  assert.equal(added.status, 0, added.stderr);
  assert.match(run("install", "node").stderr, /`node` is already a command here \(\//, "a real command is still refused, by its path");
});

test("launcher install's probe has no $( ), which fish before 3.4 can't parse, so a taken name is still refused there", () => {
  if (WIN) return; // a POSIX shell feature; CI counts a skipped test as a failure
  const home = fresh("home");
  const root = fresh("proj");
  spawnSync("git", ["init", "-q"], { cwd: root });
  // Stands in for fish 3.3: a command line holding $( fails to parse and prints nothing.
  const shell = path.join(home, "oldfish");
  writeFileSync(shell, `#!/bin/sh\ncase "$2" in *'$('*) echo "fish: \\$(...) is not supported" >&2; exit 127;; esac\nexec /bin/sh -c "$2"\n`, { mode: 0o755 });
  const env = { ...process.env, HOME: home, SHELL: shell, PATH: `${path.join(home, ".local", "bin")}${path.delimiter}${process.env.PATH}` };
  const taken = spawnSync(process.execPath, [SCRIPT, "launcher", "install", "node"], { cwd: root, env, encoding: "utf8" });
  assert.notEqual(taken.status, 0, taken.stdout);
  assert.match(taken.stderr, /`node` is already a command here \(\//);
});

test("the bar, its settings and the launcher's copy go to CLAUDE_CONFIG_DIR when it is set, and the command names the copy", () => {
  const home = fresh("home");
  const config = path.join(home, "work-account");
  const root = fresh("proj");
  spawnSync("git", ["init", "-q"], { cwd: root });
  const env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: config, SHELL: "/bin/sh" };
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, env, encoding: "utf8" });
  assert.equal(run("bar", "install").status, 0);
  assert.ok(JSON.parse(readFileSync(path.join(config, "settings.json"), "utf8")).statusLine.command.includes("work-account"));
  assert.ok(existsSync(path.join(config, "odyssey-statusline.mjs")));
  const added = run("launcher", "install", "zq-config");
  assert.equal(added.status, 0, added.stderr);
  assert.ok(existsSync(path.join(config, "odyssey-launch.mjs")));
  if (!WIN) assert.match(readFileSync(path.join(home, ".local", "bin", "zq-config"), "utf8"), /exec node '.+work-account\/odyssey-launch\.mjs'/);
  assert.ok(!existsSync(path.join(home, ".claude", "settings.json")), "nothing in ~/.claude");
});

test("when ~/.local/bin isn't on the PATH, launcher install prints the line that adds it for the user's shell", () => {
  if (WIN) return; // a POSIX shell feature; CI counts a skipped test as a failure
  const home = fresh("home");
  const root = fresh("proj");
  spawnSync("git", ["init", "-q"], { cwd: root });
  const env = { ...process.env, HOME: home, SHELL: "/bin/bash" };
  const out = spawnSync(process.execPath, [SCRIPT, "launcher", "install", "zq-path"], { cwd: root, env, encoding: "utf8" }).stdout;
  const rc = process.platform === "darwin" ? "~/.bash_profile" : "~/.bashrc";
  assert.ok(out.includes(`  echo 'export PATH="$HOME/.local/bin:$PATH"' >> ${rc}\n`), out);
  assert.ok(out.includes(`Until then, run ${path.join(home, ".local", "bin", "zq-path")}.`), out);
});
