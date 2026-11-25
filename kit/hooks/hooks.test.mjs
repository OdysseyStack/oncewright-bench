// Checks for hooks.json and the opt-in hooks: the wiring matches the spec, each opt-in
// hook is off with no config and on when switched on, post-edit formats before it checks
// imports, skips vendor folders inside the repo only and finds a workspace's Prettier, the
// steps that run code wait for trust, a bad config or a start folder that is gone fails
// open, the session-start hook states what it should and nothing more, the load log
// records each load once switched on and never fails, and bash-guard's commit gate and zsh
// guard block what they should and nothing else.
//
// Like protect-env.test.mjs, each check runs a hook as a process with a JSON payload on
// stdin, the way Claude Code does, here against scratch git repos under the temp dir.
// CLAUDE_PROJECT_DIR names the repo under test while every hook's own cwd is a separate,
// clean repo, so a hook that read its cwd would find no config. HOME points at a scratch
// home, so trust records never touch the real ~/.claude, and the temp dir the notices
// mark is the scratch dir. Offline and deterministic: the stand-in formatter and gate
// are local scripts.
//
// Run: node --test hooks/hooks.test.mjs
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { trustKey } from "../lib/trust.mjs";

const HOOKS = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HOOKS, "..", "scripts", "odyssey.mjs");
// Spelled as the file system spells it, which is how the hooks name a repo's root.
const scratch = realpathSync.native(mkdtempSync(path.join(tmpdir(), "odyssey-hooks-")));
const home = path.join(scratch, "home");
mkdirSync(home);

after(() => {
  // Verify the location before anything destructive, as protect-env.test.mjs does.
  assert.ok(scratch.startsWith(realpathSync.native(tmpdir()) + path.sep), "scratch dir is under tmpdir");
  assert.ok(path.basename(scratch).startsWith("odyssey-hooks-"), "scratch dir is ours");
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); // Windows releases handles late
});

let repos = 0;
// A fresh git repo holding `files`, plus .claude/odyssey.json when `config` is given.
function repo(config, files = {}) {
  const dir = path.join(scratch, `repo-${++repos}`);
  mkdirSync(dir);
  spawnSync("git", ["init", "-q"], { cwd: dir });
  const all = config ? { ...files, ".claude/odyssey.json": JSON.stringify(config) } : files;
  for (const [name, text] of Object.entries(all)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

const elsewhere = repo(null); // every hook's cwd: a clean repo with no config

const env = (project, extra) => ({
  ...process.env,
  CLAUDE_PROJECT_DIR: project,
  HOME: home,
  USERPROFILE: home,
  TMPDIR: scratch,
  TEMP: scratch,
  TMP: scratch,
  ...extra,
});

// Runs a hook the way Claude Code does. -> { status, stdout, stderr }
function hook(name, project, payload, extra = {}) {
  return spawnSync(process.execPath, [path.join(HOOKS, name)], {
    cwd: elsewhere,
    env: env(project, extra),
    input: JSON.stringify({ session_id: "session-1", ...payload }),
    encoding: "utf8",
  });
}

// The user's own `trust approve`, run from inside the repo.
function approve(project) {
  return spawnSync(process.execPath, [SCRIPT, "trust", "approve"], {
    cwd: project,
    env: env(undefined),
    encoding: "utf8",
  });
}

const write = (file) => ({ tool_name: "Write", tool_input: { file_path: file, content: "x" } });
const noticeOf = (result) => JSON.parse(result.stdout).systemMessage;

// A stand-in for the repo's own Prettier. It appends an import the check must flag, so
// the check's report proves the formatter ran first.
const STUB_PRETTIER =
  'require("node:fs").appendFileSync(process.argv.at(-1), \'import "./formatted-first";\\n\');\n';
// A stand-in gate command: it records each run, then fails with a recognizable error.
const STUB_GATE =
  'require("node:fs").appendFileSync("gate-runs.txt", "ran\\n");\n' +
  'console.error("TYPE ERROR in src/a.ts");\nprocess.exit(1);\n';

test("hooks.json wires every hook in exec form, with the spec's matchers and timeouts", () => {
  const wiring = JSON.parse(readFileSync(path.join(HOOKS, "hooks.json"), "utf8")).hooks;
  const seen = [];
  for (const [event, groups] of Object.entries(wiring)) {
    for (const group of groups) {
      for (const h of group.hooks) {
        assert.equal(h.command, "node");
        const script = h.args[0].replace("${CLAUDE_PLUGIN_ROOT}/hooks/", "");
        seen.push(`${event} ${group.matcher ?? "(all)"} ${script} ${h.timeout}`);
      }
    }
  }
  assert.deepEqual(seen, [
    "SessionStart (all) session-start.mjs 10",
    "InstructionsLoaded (all) load-log.mjs 10",
    "PreToolUse Edit|Write|MultiEdit|NotebookEdit protect-env.mjs 10",
    "PreToolUse Edit|Write|MultiEdit|NotebookEdit protect-managed.mjs 10",
    "PreToolUse Edit|Write|MultiEdit|NotebookEdit protect-manifest.mjs 10",
    "PreToolUse Edit|Write|MultiEdit|NotebookEdit protect-append-only.mjs 10",
    "PreToolUse Bash|PowerShell protect-env.mjs 10",
    "PreToolUse Bash|PowerShell bash-guard.mjs 600",
    "PreToolUse mcp__.*__(write_file|edit_file|move_file|edit_block) protect-env.mjs 10",
    "PostToolUse Edit|Write|MultiEdit post-edit.mjs 30",
    "Stop (all) typecheck-gate.mjs 600",
    "Stop (all) wrap-up-stop.mjs 10",
  ]);
  const wired = new Set(seen.map((line) => line.split(" ").at(-2)));
  const scripts = readdirSync(HOOKS).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"));
  assert.deepEqual(scripts.sort(), [...wired].sort(), "every hook script is wired, and only those");
});

test("protect-manifest is off with no config, and blocks manifests when switched on", () => {
  const off = repo(null);
  assert.equal(hook("protect-manifest.mjs", off, write(path.join(off, "package.json"))).status, 0);
  const on = repo({ version: 1, hooks: { protectManifest: true }, protect: { manifests: ["Cargo.toml"] } });
  assert.equal(hook("protect-manifest.mjs", on, write(path.join(on, "package.json"))).status, 2);
  assert.equal(hook("protect-manifest.mjs", on, write(path.join(on, "cargo.toml"))).status, 2);
  assert.equal(hook("protect-manifest.mjs", on, write(path.join(on, "README.md"))).status, 0);
});

test("protect-append-only is off with no config, and enforces protect.readOnly and protect.appendOnly when switched on", () => {
  const protect = { readOnly: ["AUDIT-LOG.md"], appendOnly: ["journal.md"] };
  const off = repo(null);
  assert.equal(hook("protect-append-only.mjs", off, write(path.join(off, "audit-log.md"))).status, 0);
  const listsOnly = repo({ version: 1, protect });
  assert.equal(hook("protect-append-only.mjs", listsOnly, write(path.join(listsOnly, "audit-log.md"))).status, 0);
  const on = repo({ version: 1, hooks: { protectAppendOnly: true }, protect });
  assert.equal(hook("protect-append-only.mjs", on, write(path.join(on, "audit-log.md"))).status, 2);
  assert.equal(hook("protect-append-only.mjs", on, write(path.join(on, "journal.md"))).status, 2);
  const append = {
    tool_name: "Edit",
    tool_input: { file_path: path.join(on, "journal.md"), old_string: "end", new_string: "end\nnew entry" },
  };
  assert.equal(hook("protect-append-only.mjs", on, append).status, 0);
});

test("protect-append-only lets an Edit add to an append-only file only at its end", () => {
  const on = repo(
    { version: 1, hooks: { protectAppendOnly: true }, protect: { appendOnly: ["journal.md"] } },
    { "journal.md": "first entry\n\nsecond entry\n" },
  );
  const edit = (oldText, newText) => ({
    tool_name: "Edit",
    tool_input: { file_path: path.join(on, "journal.md"), old_string: oldText, new_string: newText },
  });
  const inserted = hook("protect-append-only.mjs", on, edit("first entry", "first entry\ninserted"));
  assert.equal(inserted.status, 2);
  assert.match(inserted.stderr, /a new entry goes at the end/);
  assert.equal(hook("protect-append-only.mjs", on, edit("\n\n", "\n\ninserted\n")).status, 2, "a blank anchor is refused");
  assert.equal(hook("protect-append-only.mjs", on, edit("second entry", "second entry\nthird entry")).status, 0);
  assert.equal(hook("protect-append-only.mjs", on, edit("second entry\n", "second entry\nthird entry\n")).status, 0);
  // Two entries that end alike: with its blank line, the first one's ending occurs once, and
  // trimmed it reads like the end of the file.
  writeFileSync(path.join(on, "journal.md"), "did x\n\nnext\ndid x\n");
  assert.equal(hook("protect-append-only.mjs", on, edit("did x\n\n", "did x\n\ninserted\n\n")).status, 2, "judged by where it lands");
  assert.equal(hook("protect-append-only.mjs", on, edit("next\ndid x\n", "next\ndid x\nnew entry\n")).status, 0);
  // Windows line endings: the Edit tool matches them as "\n", so the guard reads them that way.
  writeFileSync(path.join(on, "journal.md"), "first\r\nsecond\r\nthird\r\n");
  assert.equal(hook("protect-append-only.mjs", on, edit("first\nsecond", "first\nsecond\ninserted")).status, 2);
  assert.equal(hook("protect-append-only.mjs", on, edit("second\nthird", "second\nthird\nfourth")).status, 0);
});

test("the opt-in guards read a NotebookEdit call's notebook_path", () => {
  const on = repo({
    version: 1,
    hooks: { protectManifest: true, protectAppendOnly: true },
    protect: { readOnly: ["report.ipynb"] },
  });
  const notebook = (name) => ({
    tool_name: "NotebookEdit",
    tool_input: { notebook_path: path.join(on, name), cell_id: "c1", new_source: "x" },
  });
  assert.equal(hook("protect-manifest.mjs", on, notebook("package.json")).status, 2);
  assert.equal(hook("protect-append-only.mjs", on, notebook("report.ipynb")).status, 2);
  assert.equal(hook("protect-append-only.mjs", on, notebook("other.ipynb")).status, 0);
});

test("post-edit's import check is off with no config, and flags a missing .js under srcDirs when switched on", () => {
  const files = { "src/a.ts": 'import { b } from "./b";\n', "scripts/c.ts": 'import { d } from "./d";\n' };
  const off = repo(null, files);
  assert.equal(hook("post-edit.mjs", off, write(path.join(off, "src/a.ts"))).status, 0);
  const on = repo({ version: 1, hooks: { esmImportExtension: true } }, files);
  const flagged = hook("post-edit.mjs", on, write(path.join(on, "src/a.ts")));
  assert.equal(flagged.status, 2);
  assert.match(flagged.stderr, /src\/a\.ts:1 {2}"\.\/b"/);
  assert.equal(hook("post-edit.mjs", on, write(path.join(on, "scripts/c.ts"))).status, 0, "outside srcDirs and testDirs");
  const moved = repo({ version: 1, srcDirs: ["scripts"], hooks: { esmImportExtension: true } }, files);
  assert.equal(hook("post-edit.mjs", moved, write(path.join(moved, "scripts/c.ts"))).status, 2, "srcDirs from config");
});

test("post-edit runs the formatter before the import check", () => {
  const dir = repo(
    { version: 1, hooks: { formatOnEdit: true, esmImportExtension: true } },
    { "src/a.ts": "export const a = 1;\n", "node_modules/prettier/bin/prettier.cjs": STUB_PRETTIER },
  );
  assert.equal(approve(dir).status, 0);
  const result = hook("post-edit.mjs", dir, write(path.join(dir, "src/a.ts")));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /"\.\/formatted-first"/, "the check read the formatter's output");
});

test("post-edit's formatter skips until trusted, runs after trust approve, and stops when the repo moves", () => {
  let dir = repo(
    { version: 1, hooks: { formatOnEdit: true } },
    { "src/a.ts": "export const a = 1;\n", "node_modules/prettier/bin/prettier.cjs": STUB_PRETTIER },
  );
  const file = () => path.join(dir, "src/a.ts");
  const runs = () => readFileSync(file(), "utf8").split("formatted-first").length - 1;

  const untrusted = hook("post-edit.mjs", dir, write(file()));
  assert.equal(untrusted.status, 0);
  assert.equal(runs(), 0, "an untrusted formatter does not run");
  assert.match(noticeOf(untrusted), /trust approve/);

  assert.equal(approve(dir).status, 0);
  assert.equal(hook("post-edit.mjs", dir, write(file())).status, 0);
  assert.equal(runs(), 1, "trusted, it runs");

  renameSync(dir, `${dir}-moved`);
  dir = `${dir}-moved`;
  assert.equal(hook("post-edit.mjs", dir, write(file())).status, 0);
  assert.equal(runs(), 1, "a moved repo needs approving again");

  // A repo's own settings file can set a variable for every hook, so none grants trust.
  assert.equal(hook("post-edit.mjs", dir, write(file()), { ODYSSEY_TRUST_CONFIGURED_COMMANDS: "1" }).status, 0);
  assert.equal(runs(), 1, "no environment variable trusts it");
});

test("trust follows the folder, in whatever letter case its path is typed", () => {
  const dir = repo(
    { version: 1, hooks: { formatOnEdit: true } },
    { "src/a.ts": "export const a = 1;\n", "node_modules/prettier/bin/prettier.cjs": STUB_PRETTIER },
  );
  const typed = path.join(path.dirname(dir), path.basename(dir).toUpperCase());
  // On a file system that tells letter case apart, the other spelling names no folder.
  if (!existsSync(typed)) return;
  assert.equal(approve(dir).status, 0);
  assert.equal(hook("post-edit.mjs", typed, write(path.join(typed, "src/a.ts"))).status, 0);
  assert.match(
    readFileSync(path.join(dir, "src/a.ts"), "utf8"),
    /formatted-first/,
    "approved under one spelling, trusted under the other",
  );
});

test("post-edit's formatter never rewrites an append-only file", () => {
  const dir = repo(
    { version: 1, hooks: { formatOnEdit: true }, protect: { appendOnly: ["JOURNAL.md"] } },
    { "journal.md": "first entry\n", "notes.md": "a note\n", "node_modules/prettier/bin/prettier.cjs": STUB_PRETTIER },
  );
  assert.equal(approve(dir).status, 0);
  const formatted = (name) => readFileSync(path.join(dir, name), "utf8").includes("formatted-first");
  assert.equal(hook("post-edit.mjs", dir, write(path.join(dir, "journal.md"))).status, 0);
  assert.equal(formatted("journal.md"), false, "the append-only file is left as it was");
  assert.equal(hook("post-edit.mjs", dir, write(path.join(dir, "notes.md"))).status, 0);
  assert.equal(formatted("notes.md"), true, "any other file is still formatted");
});

test("post-edit skips a node_modules or dist folder inside the repo, and checks a repo that sits in a folder named dist", () => {
  const config = { version: 1, hooks: { esmImportExtension: true } };
  const files = {
    "src/a.ts": 'import { b } from "./b";\n',
    "src/dist/c.ts": 'import { d } from "./d";\n',
    "src/node_modules/e/f.ts": 'import { g } from "./g";\n',
  };
  const inside = repo(config, files);
  assert.equal(hook("post-edit.mjs", inside, write(path.join(inside, "src/a.ts"))).status, 2);
  assert.equal(hook("post-edit.mjs", inside, write(path.join(inside, "src/dist/c.ts"))).status, 0, "a dist folder in the repo is skipped");
  assert.equal(hook("post-edit.mjs", inside, write(path.join(inside, "src/node_modules/e/f.ts"))).status, 0, "so is node_modules");
  const under = path.join(scratch, "dist", "app");
  mkdirSync(path.dirname(under));
  renameSync(repo(config, files), under);
  assert.equal(hook("post-edit.mjs", under, write(path.join(under, "src/a.ts"))).status, 2, "the folders above the repo don't count");
});

test("post-edit's formatter finds a workspace's Prettier at the git root, and none above it", () => {
  const top = repo(null, {
    "node_modules/prettier/bin/prettier.cjs": STUB_PRETTIER,
    "packages/app/.claude/odyssey.json": JSON.stringify({ version: 1, hooks: { formatOnEdit: true } }),
    "packages/app/src/a.ts": "export const a = 1;\n",
  });
  const app = path.join(top, "packages", "app");
  assert.equal(approve(app).status, 0);
  assert.equal(hook("post-edit.mjs", app, write(path.join(app, "src/a.ts"))).status, 0);
  assert.match(readFileSync(path.join(app, "src/a.ts"), "utf8"), /formatted-first/, "the Prettier at the workspace's root ran");

  const above = path.join(scratch, "above");
  mkdirSync(path.join(above, "node_modules", "prettier", "bin"), { recursive: true });
  writeFileSync(path.join(above, "node_modules", "prettier", "bin", "prettier.cjs"), STUB_PRETTIER);
  const inner = path.join(above, "project");
  renameSync(repo({ version: 1, hooks: { formatOnEdit: true } }, { "src/a.ts": "export const a = 1;\n" }), inner);
  assert.equal(approve(inner).status, 0);
  assert.equal(hook("post-edit.mjs", inner, write(path.join(inner, "src/a.ts"))).status, 0);
  assert.doesNotMatch(readFileSync(path.join(inner, "src/a.ts"), "utf8"), /formatted-first/, "a Prettier above the git root never runs");
});

test("typecheck-gate is off with no config, and runs its command only once trusted", () => {
  const files = { "src/a.ts": "export const a = 1;\n", "gate.cjs": STUB_GATE };
  const off = repo(null, files);
  assert.equal(hook("typecheck-gate.mjs", off, { hook_event_name: "Stop" }).status, 0);
  assert.equal(existsSync(path.join(off, "gate-runs.txt")), false);

  const gate = { enabled: true, command: "node gate.cjs" };
  const dir = repo({ version: 1, hooks: { typecheckGate: gate } }, files);
  const runs = () =>
    existsSync(path.join(dir, "gate-runs.txt")) ? readFileSync(path.join(dir, "gate-runs.txt"), "utf8").split("\n").length - 1 : 0;
  const stop = (extra) => hook("typecheck-gate.mjs", dir, { hook_event_name: "Stop", stop_hook_active: false }, extra);

  const untrusted = stop();
  assert.equal(untrusted.status, 0);
  assert.equal(runs(), 0, "an untrusted command does not run");
  assert.match(noticeOf(untrusted), /trust approve/);

  assert.equal(approve(dir).status, 0);
  const trusted = stop();
  assert.equal(trusted.status, 2, "trusted, it runs, and its errors block the stop");
  assert.match(trusted.stderr, /TYPE ERROR in src\/a\.ts/);
  assert.equal(runs(), 1);

  const changed = { version: 1, hooks: { typecheckGate: { ...gate, command: "node gate.cjs --changed" } } };
  writeFileSync(path.join(dir, ".claude", "odyssey.json"), JSON.stringify(changed));
  assert.equal(stop().status, 0);
  assert.equal(runs(), 1, "a changed command stops until it is approved again");

  assert.equal(stop({ ODYSSEY_TRUST_CONFIGURED_COMMANDS: "1" }).status, 0);
  assert.equal(runs(), 1, "no environment variable trusts a command");
});

test("typecheck-gate reads a long report whole: a green run passes, and a failure keeps its end", () => {
  const files = {
    "src/a.ts": "export const a = 1;\n",
    // 2 MB on a green run: more than a child process may print by default.
    "loud.cjs": 'process.stdout.write("x".repeat(2 * 1024 * 1024) + "\\n");\n',
    // 400 lines of about 500 characters, then the summary: more than a pipe holds at once.
    "long.cjs":
      'for (let i = 1; i <= 400; i++) console.log("line " + i + " " + "e".repeat(500));\n' +
      'console.log("SUMMARY: 400 errors");\nprocess.exitCode = 1;\n',
  };
  const gate = (command) => {
    const dir = repo({ version: 1, hooks: { typecheckGate: { enabled: true, command } } }, files);
    assert.equal(approve(dir).status, 0);
    return hook("typecheck-gate.mjs", dir, { hook_event_name: "Stop" });
  };
  assert.equal(gate("node loud.cjs").status, 0, "a green run that prints 2 MB is green");
  const failed = gate("node long.cjs");
  assert.equal(failed.status, 2);
  assert.match(failed.stderr, /SUMMARY: 400 errors\n$/, "the end of the report arrives");
  assert.match(failed.stderr, /the start of the output is left out/);
  assert.doesNotMatch(failed.stderr, /line 1 /);
  assert.ok(failed.stderr.length < 10000, "short enough for Claude Code to show whole");
});

test("typecheck-gate enforces its own timeoutSec and says so", () => {
  const dir = repo(
    { version: 1, hooks: { typecheckGate: { enabled: true, command: "node hang.cjs", timeoutSec: 1 } } },
    {
      "src/a.ts": "export const a = 1;\n",
      "hang.cjs": 'require("node:fs").writeFileSync("hang.pid", String(process.pid));\nsetTimeout(() => {}, 30000);\n',
    },
  );
  assert.equal(approve(dir).status, 0);
  const started = Date.now();
  const result = hook("typecheck-gate.mjs", dir, { hook_event_name: "Stop" });
  assert.equal(result.status, 0, "a timed-out gate lets the turn end");
  assert.match(noticeOf(result), /did not finish within 1s/);
  assert.ok(Date.now() - started < 15000, "stopped at its own limit, not the 30s command");
  // On Windows the limit kills the shell, and the 30s command it started keeps this folder
  // busy until it ends, which would fail the teardown: end it here.
  try {
    process.kill(Number(readFileSync(path.join(dir, "hang.pid"), "utf8")));
  } catch {
    // already gone: on macOS and Linux the shell became the command, and the limit ended it
  }
});

test("typecheck-gate reports a second failure as a notice, and lets the turn end", () => {
  // stop_hook_active marks the turn Claude continued after the gate blocked the stop once.
  const dir = repo(
    { version: 1, hooks: { typecheckGate: { enabled: true, command: "node gate.cjs" } } },
    { "src/a.ts": "export const a = 1;\n", "gate.cjs": STUB_GATE },
  );
  assert.equal(approve(dir).status, 0);
  const again = hook("typecheck-gate.mjs", dir, { hook_event_name: "Stop", stop_hook_active: true });
  assert.equal(again.status, 0, "a second failure lets the turn end");
  assert.match(noticeOf(again), /Still failing after a prior fix attempt[\s\S]*TYPE ERROR in src\/a\.ts/);
});

test("typecheck-gate stays silent on a turn that changed no TypeScript, trusted or not", () => {
  // The scope guard runs before the trust check, so an untrusted gate says nothing on a
  // Q&A turn or a docs-only edit: its notice would only repeat what apply printed.
  const dir = repo(
    { version: 1, hooks: { typecheckGate: { enabled: true, command: "node gate.cjs" } } },
    { "src/a.ts": "export const a = 1;\n", "gate.cjs": STUB_GATE },
  );
  const git = (...args) => spawnSync("git", args, { cwd: dir, env: env(dir) });
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "base");
  const stop = () => hook("typecheck-gate.mjs", dir, { hook_event_name: "Stop", stop_hook_active: false });

  const clean = stop();
  assert.equal(clean.status, 0);
  assert.equal(clean.stdout, "", "untrusted, but nothing compilable changed: no notice");
  assert.equal(existsSync(path.join(dir, "gate-runs.txt")), false, "and no run");

  writeFileSync(path.join(dir, "src", "b.ts"), "export const b = 2;\n");
  assert.match(noticeOf(stop()), /trust approve/, "a changed .ts brings the notice back");
  assert.equal(approve(dir).status, 0);
  assert.equal(stop().status, 2, "trusted, it runs on the changed file");
});

// Commits the repo as it stands and adds a linked git worktree of it at `at`. -> its real path
function worktree(dir, at) {
  const git = (...args) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { cwd: dir });
  git("add", "-A");
  git("commit", "-qm", "base");
  assert.equal(git("worktree", "add", "-q", at).status, 0, "git worktree add");
  return realpathSync.native(at);
}

test("post-edit checks a file in a linked worktree of the session's repo, with that worktree's config", () => {
  const dir = repo({ version: 1, hooks: { esmImportExtension: true } }, { "src/a.ts": "export const a = 1;\n" });
  const bad = 'import { b } from "./b";\n';
  for (const wt of [worktree(dir, path.join(scratch, "wt-import")), worktree(dir, path.join(dir, ".claude", "worktrees", "x"))]) {
    writeFileSync(path.join(wt, "src", "a.ts"), bad);
    const flagged = hook("post-edit.mjs", dir, write(path.join(wt, "src", "a.ts")));
    assert.equal(flagged.status, 2, `a bad import in ${wt} is flagged`);
    assert.match(flagged.stderr, /src\/a\.ts:1 {2}"\.\/b"/, "named from the worktree's top");
  }
  const wt = path.join(scratch, "wt-import");
  writeFileSync(path.join(wt, ".claude", "odyssey.json"), JSON.stringify({ version: 1 }));
  assert.equal(hook("post-edit.mjs", dir, write(path.join(wt, "src", "a.ts"))).status, 0, "the worktree's own config applies");
});

test("post-edit stays in the worktree when the folder matching the session's start links out of it", () => {
  // The session starts in pkg/; in the worktree, pkg is a link to another repo, whose config
  // switches the import check off.
  const dir = repo({ version: 1, hooks: { esmImportExtension: true } }, { "src/a.ts": "export const a = 1;\n", "pkg/notes.md": "x\n" });
  const other = repo({ version: 1 }, { "src/a.ts": "export const a = 1;\n" });
  const wt = worktree(dir, path.join(scratch, "wt-linked-start"));
  rmSync(path.join(wt, "pkg"), { recursive: true, force: true });
  try {
    symlinkSync(other, path.join(wt, "pkg"), "junction");
  } catch (err) {
    if (err.code === "EPERM") return; // Windows without the right to make a link
    throw err;
  }
  writeFileSync(path.join(wt, "src", "a.ts"), 'import { b } from "./b";\n');
  const flagged = hook("post-edit.mjs", path.join(dir, "pkg"), write(path.join(wt, "src", "a.ts")));
  assert.equal(flagged.status, 2, "checked with the worktree's config, not the linked repo's");
  assert.match(flagged.stderr, /src\/a\.ts:1 {2}"\.\/b"/);
});

test("typecheck-gate follows the hook's cwd into a linked worktree of the session's repo", () => {
  const gate = { enabled: true, command: "node gate.cjs" };
  const dir = repo({ version: 1, hooks: { typecheckGate: gate } }, { "src/a.ts": "export const a = 1;\n", "gate.cjs": STUB_GATE });
  const wt = worktree(dir, path.join(scratch, "wt-gate"));
  assert.equal(approve(dir).status, 0);
  const stop = (cwd) => hook("typecheck-gate.mjs", dir, { hook_event_name: "Stop", stop_hook_active: false, cwd });
  writeFileSync(path.join(wt, "src", "a.ts"), "export const a = 2;\n");
  const result = stop(wt);
  assert.equal(result.status, 2, "the worktree's change is gated");
  assert.ok(existsSync(path.join(wt, "gate-runs.txt")), "the command ran in the worktree");
  assert.equal(stop(dir).status, 0, "from the session's own checkout, the worktree's change is not checked");
  assert.equal(stop(elsewhere).status, 0, "a cwd in another repo leaves the session's checkout in charge");
});

test("trust covers a repo's linked worktrees, and a .git file git doesn't link back to counts as its own folder", () => {
  const files = { "src/a.ts": "export const a = 1;\n", "node_modules/prettier/bin/prettier.cjs": STUB_PRETTIER };
  const config = { version: 1, hooks: { formatOnEdit: true } };
  const dir = repo(config, files);
  const wt = worktree(dir, path.join(scratch, "wt-trust"));
  const ran = (at) => readFileSync(path.join(at, "src", "a.ts"), "utf8").includes("formatted-first");

  assert.equal(approve(wt).status, 0, "approved from inside the worktree");
  const list = spawnSync(process.execPath, [SCRIPT, "trust", "list"], { env: env(undefined), encoding: "utf8" }).stdout;
  assert.ok(list.includes(`${dir}: post-edit formatter`), "recorded under the repo's own folder");
  assert.ok(!list.includes(wt), "not under the worktree's");
  assert.equal(hook("post-edit.mjs", dir, write(path.join(dir, "src", "a.ts"))).status, 0);
  assert.ok(ran(dir), "the repo's checkout shares the approval");
  assert.equal(hook("post-edit.mjs", wt, write(path.join(wt, "src", "a.ts"))).status, 0);
  assert.ok(ran(wt), "a session started in the worktree shares it");

  // A copy whose .git file names the repo, or one of its worktrees, without git's own record
  // pointing back at it, as a downloaded folder could.
  for (const [name, gitdir] of [["fake-repo", path.join(dir, ".git")], ["fake-wt", path.join(dir, ".git", "worktrees", "wt-trust")]]) {
    const fake = repo(config, files);
    rmSync(path.join(fake, ".git"), { recursive: true, force: true });
    writeFileSync(path.join(fake, ".git"), `gitdir: ${gitdir}\n`);
    const result = hook("post-edit.mjs", fake, write(path.join(fake, "src", "a.ts")));
    assert.equal(ran(fake), false, `${name}: not trusted`);
    assert.match(noticeOf(result), /trust approve/);
  }
});

// A folder whose .git is a symbolic link to `target` in a repo whose formatter is approved. The link
// is not git's own record, so the folder keeps its own trust key, and the formatter doesn't run
// under the repo's approval.
function symlinkedGit(name, target, type) {
  const files = { "src/a.ts": "export const a = 1;\n", "node_modules/prettier/bin/prettier.cjs": STUB_PRETTIER };
  const config = { version: 1, hooks: { formatOnEdit: true } };
  const dir = repo(config, files);
  const wt = worktree(dir, path.join(scratch, `wt-${name}`));
  assert.equal(approve(dir).status, 0);
  const fake = repo(config, files);
  rmSync(path.join(fake, ".git"), { recursive: true, force: true });
  try {
    symlinkSync(path.join(target === "repo" ? dir : wt, ".git"), path.join(fake, ".git"), type);
  } catch (err) {
    if (err.code === "EPERM") return; // Windows without the right to make a file link
    throw err;
  }
  assert.equal(trustKey(fake), fake, "keyed by its own path");
  const result = hook("post-edit.mjs", fake, write(path.join(fake, "src", "a.ts")));
  assert.doesNotMatch(readFileSync(path.join(fake, "src", "a.ts"), "utf8"), /formatted-first/, "not trusted");
  assert.match(noticeOf(result), /trust approve/);
}

test("a .git that is a symbolic link to a trusted repo's .git folder counts as no repo", () => {
  symlinkedGit("link-to-repo", "repo", "junction");
});

test("a .git that is a symbolic link to a trusted repo's worktree's .git file counts as no repo", () => {
  symlinkedGit("link-to-wt", "wt", "file");
});

test("an invalid config switches the opt-in hooks off, with one notice per session", () => {
  const dir = repo({
    version: 1,
    hooks: { protectManifest: true, protectAppendOnly: true },
    protect: { readOnly: ["package.json"] },
    typo: true,
  });
  const payload = write(path.join(dir, "package.json"));
  const first = hook("protect-manifest.mjs", dir, payload);
  const second = hook("protect-append-only.mjs", dir, payload);
  assert.equal(first.status, 0, "fails open");
  assert.equal(second.status, 0, "fails open");
  const notices = [first, second].filter((result) => result.stdout !== "");
  assert.equal(notices.length, 1, "one notice per session");
  assert.match(noticeOf(notices[0]), /unknown key "typo"/);
  const nextSession = hook("protect-manifest.mjs", dir, { ...payload, session_id: "session-2" });
  assert.match(noticeOf(nextSession), /opt-in hooks are off/, "a new session is told again");
});

test("a start folder that is gone switches the opt-in hooks off, and says so", () => {
  const gone = path.join(scratch, "gone");
  const result = hook("protect-manifest.mjs", gone, write(path.join(gone, "package.json")));
  assert.equal(result.status, 0, "fails open");
  assert.match(noticeOf(result), /can't be read \(ENOENT\), so its opt-in hooks are off/);
});

// The placeholder /odyssey:setup writes into the handoff.
const PLACEHOLDER = (slot) => readFileSync(path.join(HOOKS, "..", "scaffold", "directives", slot, "current.md"), "utf8");
const start = (source) => ({ hook_event_name: "SessionStart", source });

// The hook's JSON: Claude's lines in additionalContext, the user's in systemMessage.
const said = (result) => (result.stdout ? JSON.parse(result.stdout) : null);
const context = (result) => said(result)?.hookSpecificOutput?.additionalContext;
const CLAUDE_LINES = {
  compact: "Odyssey: this session was compacted: a summary replaced its earlier turns.",
  handoff: "Odyssey: a handoff message is waiting in directives/handoff/current.md; /odyssey:handoff reads it.",
};

test("the session-start hook tells Claude of a compaction, and a waiting handoff, shows the user the handoff, and says nothing the file says", () => {
  const dir = repo(null, {
    "directives/handoff/current.md": "MESSAGE-TEXT: start with the plan.\n",
  });
  const compacted = hook("session-start.mjs", dir, start("compact"));
  assert.equal(compacted.status, 0);
  assert.equal(said(compacted).hookSpecificOutput.hookEventName, "SessionStart");
  assert.equal(context(compacted), [CLAUDE_LINES.compact, CLAUDE_LINES.handoff].join("\n"));
  assert.equal(said(compacted).systemMessage, undefined, "no line for the user after a compaction");
  assert.doesNotMatch(compacted.stdout, /MESSAGE-TEXT/, "nothing the file says");
  for (const source of ["startup", "resume", "clear", "fork"]) {
    const result = hook("session-start.mjs", dir, start(source));
    assert.equal(result.status, 0);
    assert.equal(context(result), CLAUDE_LINES.handoff, source);
    assert.equal(said(result).systemMessage, "Odyssey: a handoff message is waiting; run /odyssey:handoff to read it.", source);
    assert.doesNotMatch(result.stdout, /MESSAGE-TEXT/, source);
  }
  const handoffOnly = repo(null, { "directives/handoff/current.md": "MESSAGE-TEXT\n" });
  assert.equal(said(hook("session-start.mjs", handoffOnly, start("startup"))).systemMessage, "Odyssey: a handoff message is waiting; run /odyssey:handoff to read it.");
  const oldOrder = repo(null, { "directives/layer_3_work_orders/current.md": "ORDER-TEXT\n" });
  assert.equal(hook("session-start.mjs", oldOrder, start("resume")).stdout, "", "a work order an older kit left is not reported");
});

test("the session-start hook says nothing when there is nothing to say", () => {
  const empty = repo(null, {
    "directives/handoff/current.md": PLACEHOLDER("handoff"),
  });
  for (const source of ["startup", "resume", "clear"]) {
    const result = hook("session-start.mjs", empty, start(source));
    assert.equal(result.status, 0, source);
    assert.equal(result.stdout, "", `${source}: the placeholder holds nothing`);
  }
  assert.equal(hook("session-start.mjs", repo(null), start("startup")).stdout, "", "no directives at all");
  const gone = hook("session-start.mjs", path.join(scratch, "gone-at-start"), start("compact"));
  assert.equal(gone.status, 0, "fails open");
  assert.equal(context(gone), CLAUDE_LINES.compact, "the compaction is still stated");
  assert.equal(said(gone).systemMessage, undefined);
});

// The load log's file for a repo, as the hook and the docs check name it.
const loadLog = (root) =>
  path.join(home, ".claude", "odyssey-loads", `${createHash("sha256").update(root).digest("hex").slice(0, 16)}.jsonl`);
const loaded = (file, reason) => ({ hook_event_name: "InstructionsLoaded", file_path: file, memory_type: "Project", load_reason: reason });

test("the load log is off with no config, logs each load once switched on, starts over past its cap, and never fails", () => {
  const off = repo(null, { "CLAUDE.md": "x\n" });
  const quiet = hook("load-log.mjs", off, loaded(path.join(off, "CLAUDE.md"), "session_start"));
  assert.equal(quiet.status, 0);
  assert.equal(quiet.stdout, "");
  assert.equal(existsSync(loadLog(off)), false, "off: nothing is written");

  const on = repo({ version: 1, hooks: { loadLog: true } }, { "CLAUDE.md": "x\n", "docs/guide.md": "y\n" });
  for (const [file, reason] of [["CLAUDE.md", "session_start"], ["docs/guide.md", "include"]]) {
    const result = hook("load-log.mjs", on, loaded(path.join(on, file), reason));
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "", "no output: Claude Code drops it anyway");
  }
  const lines = readFileSync(loadLog(on), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(
    lines.map(({ session, file, reason }) => [session, file, reason]),
    [
      ["session-1", path.join(on, "CLAUDE.md"), "session_start"],
      ["session-1", path.join(on, "docs/guide.md"), "include"],
    ],
  );
  assert.ok(lines.every(({ time }) => !Number.isNaN(Date.parse(time))), "each line carries its time");

  writeFileSync(loadLog(on), "x".repeat(256 * 1024 + 1));
  hook("load-log.mjs", on, loaded(path.join(on, "CLAUDE.md"), "compact"));
  assert.equal(readFileSync(loadLog(on), "utf8").trim().split("\n").length, 1, "past the cap it starts over");

  const garbled = spawnSync(process.execPath, [path.join(HOOKS, "load-log.mjs")], { cwd: elsewhere, env: env(on), input: "not json", encoding: "utf8" });
  assert.equal(garbled.status, 0, "an unreadable payload fails silent");
  assert.equal(garbled.stdout, "");
});

// A stand-in gate: lint fails with a recognizable error, test records that it ran and passes.
const GATE_FILES = {
  "lint.cjs": 'console.log("checking");\nconsole.error("LINT ERROR in src/a.js:3");\nprocess.exit(1);\n',
  "test.cjs": 'require("node:fs").appendFileSync("test-runs.txt", "ran\\n");\n',
};
const LINT = { name: "lint", command: "node lint.cjs" };
const TEST = { name: "test", command: "node test.cjs" };
const bash = (dir, command) => hook("bash-guard.mjs", dir, { tool_name: "Bash", tool_input: { command }, cwd: dir });

test("the commit gate blocks a commit on a failing stage after running every stage, and lets it through when all pass", () => {
  const dir = repo({ version: 1, gate: { stages: [LINT, TEST] } }, GATE_FILES);
  assert.equal(approve(dir).status, 0);
  const red = bash(dir, 'git add -A && git commit -m "wip"');
  assert.equal(red.status, 2);
  assert.match(red.stderr, /^Commit blocked: the repo's gate failed 1 of 3 stages \(lint\)\./);
  assert.match(red.stderr, /--- lint ---\nchecking\nLINT ERROR in src\/a\.js:3/);
  assert.equal(readFileSync(path.join(dir, "test-runs.txt"), "utf8"), "ran\n", "the stage after the failing one still ran");

  const green = repo({ version: 1, gate: { stages: [TEST] } }, GATE_FILES);
  assert.equal(approve(green).status, 0);
  const passed = bash(green, "git commit -m wip");
  assert.equal(passed.status, 0);
  assert.equal(passed.stdout + passed.stderr, "", "a green gate is silent");
  assert.equal(readFileSync(path.join(green, "test-runs.txt"), "utf8"), "ran\n");
});

test("the commit gate's docs stage fails a commit on a broken docs claim", () => {
  const dir = repo({ version: 1, gate: { stages: [TEST] } }, { ...GATE_FILES, "CLAUDE.md": "See `docs/missing.md`.\n" });
  assert.equal(approve(dir).status, 0);
  const red = bash(dir, "git commit -m wip");
  assert.equal(red.status, 2);
  assert.match(red.stderr, /failed 1 of 2 stages \(docs\)/);
  assert.match(red.stderr, /--- docs ---\nCLAUDE\.md:1 error: `docs\/missing\.md` does not exist/);
});

test("the commit gate lets a commit through with no gate, when switched off, and until its stages are trusted", () => {
  const none = repo({ version: 1 }, GATE_FILES);
  assert.equal(bash(none, "git commit -m wip").status, 0);
  const noConfig = repo(null, GATE_FILES);
  assert.equal(bash(noConfig, "git commit -m wip").status, 0);

  const off = repo({ version: 1, gate: { stages: [LINT] }, hooks: { commitGate: false } }, GATE_FILES);
  assert.equal(bash(off, "git commit -m wip").status, 0);

  const dir = repo({ version: 1, gate: { stages: [LINT, TEST] } }, GATE_FILES);
  const untrusted = bash(dir, "git commit -m wip");
  assert.equal(untrusted.status, 0);
  assert.match(noticeOf(untrusted), /The commit gate .* did not run, because you have not trusted it[\s\S]*trust approve/);
  assert.equal(existsSync(path.join(dir, "test-runs.txt")), false, "no stage ran");
  assert.equal(approve(dir).status, 0);
  assert.equal(bash(dir, "git commit -m wip").status, 2, "trusted, it runs");
});

test("the commit gate fires on each way of running git commit, and not on commit-tree, quoted text or other commands", () => {
  const dir = repo({ version: 1, gate: { stages: [LINT] } }, GATE_FILES);
  assert.equal(approve(dir).status, 0);
  const commits = [
    "git commit -m wip",
    "cd . && git -C . commit -m wip",
    "GIT_AUTHOR_NAME=a git -c user.name=b --no-pager commit --amend --no-edit",
    "npm test; /usr/bin/git commit -am 'fix: a; b'",
    "git add -A &&\ngit commit -F - <<'MSG'\nThe message\nMSG",
  ];
  for (const command of commits) assert.equal(bash(dir, command).status, 2, command);
  const ps = hook("bash-guard.mjs", dir, { tool_name: "PowerShell", tool_input: { command: 'git.exe commit -m "wip"' }, cwd: dir });
  assert.equal(ps.status, 2, "PowerShell");

  const others = [
    "git commit-tree HEAD^{tree} -m wip",
    'echo "git commit -m wip"',
    "git log --grep 'git commit'",
    "git status && npm test",
    "cat > notes.txt <<'EOF'\ngit commit -m wip\nEOF",
    "# git commit -m wip",
    `git -C ${elsewhere} commit -m wip`,
  ];
  for (const command of others) assert.equal(bash(dir, command).status, 0, command);
});

test("the zsh guard blocks zsh's (P) and (f) expansion flags in Bash, and lets plain tests and other languages' ${( strings through", () => {
  const dir = repo(null);
  for (const command of ['echo "${(P)name}"', 'for line in ${(f)"$(ls)"}; do :; done', "print -l ${(@f)x}"]) {
    const blocked = bash(dir, command);
    assert.equal(blocked.status, 2, command);
    assert.match(blocked.stderr, /^Blocked: zsh's \(P\) and \(f\) expansion flags[\s\S]*\[ -n "\$NAME" \], one name at a time/);
  }
  for (const command of ['[ -n "$NAME" ] && echo set || echo unset', "echo ${HOME} ${#PATH}", "echo ${x:-(fallback)}",
    "python3 -c 'n = 3; fixed = 1; print(f\"${(n - fixed) / 2:.2f}\")'", "node -e 'console.log(`${(n).toFixed(2)}`)'"]) {
    assert.equal(bash(dir, command).status, 0, command);
  }
});
