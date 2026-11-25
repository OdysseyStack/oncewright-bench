#!/usr/bin/env node
// Stop hook: run the project's verification gate when Claude finishes a turn
// that touched compilable source - before hand-back.
//
// Why a Stop hook and not PostToolUse: a full project typecheck is too slow to
// run after every single edit. Running it once, when Claude is about to stop,
// gives the same guarantee far more cheaply.
//
// Scope guard: only runs when the working tree has changed files matching
// SRC_EXT under srcDirs and testDirs. A Q&A turn or a docs/config-only edit stops
// silently and never spins up the compiler. The working tree is the one the session's cwd
// is in when Claude has moved into a linked git worktree of the session's repo, with that
// worktree's config; else the checkout the session started in.
//
// Exit 2 on errors BLOCKS the stop and shows the output back to Claude ("you
// still have errors - keep going"). Once green it exits 0 and the turn ends.
// The loop is self-terminating: it releases the moment the gate is green, and
// if a prior fix attempt still fails it yields to a human rather than looping.
//
// Opt-in and trusted: it runs only when `hooks.typecheckGate` is enabled in
// .claude/odyssey.json, and runs its `command` only once the user has trusted that
// exact command for this repo. The scope guard comes before the trust check, so an
// untrusted gate says it did not run only on a turn that would have run it. It
// enforces its own `timeoutSec` limit (default 300) under the 600-second ceiling
// hooks.json sets; a gate that times out lets the turn end and says so. A long report
// keeps its end, where a compiler or a test runner prints its summary.
import { execFileSync, spawnSync } from "node:child_process";
import { configFor, hookInput, notice, noticeOnce } from "../lib/config.mjs";
import { isTrusted, untrusted } from "../lib/trust.mjs";

const GATE_NAME = "Typecheck gate";
const SRC_EXT = /\.(ts|tsx|mts|cts)$/i;

let input;
try {
  input = hookInput();
} catch {
  process.exit(0);
}
// The session's cwd, which follows Claude into a linked git worktree: the gate checks the
// checkout Claude is working in, with the config it gives.
const forCwd = configFor(input.payload?.cwd, input);
if (forCwd.notice) noticeOnce(input.payload, forCwd.notice);
const { payload } = input;
const { root, config } = forCwd;
const gate = config.hooks?.typecheckGate;
if (gate?.enabled !== true || !gate.command) process.exit(0);
const GATE_CMD = gate.command;
const SRC_DIRS = [...(config.srcDirs ?? ["src"]), ...(config.testDirs ?? ["test"])];
if (SRC_DIRS.length === 0) process.exit(0);
const TIMEOUT_SEC = gate.timeoutSec ?? 300;

// True when we are already inside a stop-hook-triggered continuation. If the
// gate is STILL failing at that point, surface the errors once more but let the
// turn end (exit 0) so a human can step in - never force an unbounded fix loop.
const alreadyContinuing = payload?.stop_hook_active === true;

function changedFiles() {
  try {
    // The dirs go to git as pathspecs, relative to the repo root, so git filters by them.
    const out = execFileSync(
      "git",
      ["status", "--porcelain", "--untracked-files=all", "--", ...SRC_DIRS],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    // porcelain lines: "XY path"; renames render "old -> new" - keep the new path.
    return out
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.slice(3).trim())
      .map((p) => (p.includes(" -> ") ? p.split(" -> ").pop() : p))
      .map((p) => p.replace(/^"(.*)"$/, "$1"));
  } catch {
    return null; // not a git repo / git unavailable -> run the gate anyway (fail safe)
  }
}

const files = changedFiles();
if (files !== null) {
  const touched = files.some((p) => SRC_EXT.test(p));
  if (!touched) process.exit(0); // nothing compilable changed - stop silently
}

if (!isTrusted(root, GATE_CMD)) {
  noticeOnce(payload, untrusted(`${GATE_NAME} (\`${GATE_CMD}\`)`, root));
  process.exit(0);
}

// ponytail: the time limit kills the command's own process, not processes it
// started; a command that leaves a child running keeps it running. Kill the
// process group if that bites.
const run = spawnSync(GATE_CMD, {
  cwd: root,
  shell: true,
  encoding: "utf8",
  timeout: TIMEOUT_SEC * 1000,
  maxBuffer: 64 * 1024 * 1024, // the default, 1 MB, fails a command that prints more
});
if (run.error) {
  const why =
    run.error.code === "ETIMEDOUT" ? `did not finish within ${TIMEOUT_SEC}s` : `did not run to its end (${run.error.code})`;
  notice(`${GATE_NAME}: \`${GATE_CMD}\` ${why}, so this turn is not verified.`);
  process.exit(0);
}
if (run.status === 0) process.exit(0);

// The report keeps the end of the output: its last 200 lines, and of those no more than
// 9,000 characters, since Claude Code shows only the start of a hook message over 10,000.
const all = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();
let kept = all.split(/\r?\n/).slice(-200).join("\n");
if (kept.length > 9000) kept = kept.slice(-9000).replace(/^[^\n]*\n/, "");
const output = kept.length < all.length ? `(the start of the output is left out; this is its end)\n${kept}` : all;

// No process.exit after these writes: it would end the process with text still on its way
// down the pipe, and the report would arrive cut short.
const header = `${GATE_NAME}: \`${GATE_CMD}\` reported errors - the work is NOT green.`;
if (alreadyContinuing) {
  // A notice, not stderr: Claude Code shows nothing a hook writes to stderr when it exits 0.
  notice(`${header}\nStill failing after a prior fix attempt - surfacing and yielding for review:\n\n${output}`);
} else {
  process.stderr.write(`${header} Fix these before handing back:\n\n${output}\n`);
  process.exitCode = 2;
}
