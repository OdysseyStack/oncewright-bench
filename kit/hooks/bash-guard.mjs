#!/usr/bin/env node
// PreToolUse hook on Bash and PowerShell: two checks on a command before it runs, so the rules
// they enforce cost Claude no instruction text until they fire.
//
// 1. The zsh guard, always on, Bash only: a command that uses zsh's (P) or (f) expansion flags
//    is blocked with the plain test to use instead. Claude Code's own safety check refuses
//    those expansions, and a background agent stalls on the refusal; blocking here gives
//    Claude the fix at once.
// 2. The commit gate: a command that runs `git commit` first runs the repo's gate, the way
//    /odyssey:local-gate's gate.md defines it: each `gate.stages` command, then the docs stage
//    (the kit's docs check, then `docs.check` when set), every stage run to its end. A failing
//    stage blocks the call, with the failing stages' names and the end of their output; a
//    green gate lets it through silently. It is on whenever the config names gate stages, and
//    `hooks.commitGate: false` turns it off. The stage commands are the repo's code, so they
//    run only once the user has trusted them (lib/trust.mjs); until then the commit goes
//    through, and the user is told once per session.
//
// The commit match reads the command the way a shell splits it: at ; & | ( ) and newlines
// outside quotes, with heredoc bodies and quoted text left out, after any VAR=value words and a
// `command`, `env`, `exec`, `nohup` or `time` in front. It finds `git commit` and
// `git -C <dir> commit` (git's other global options skipped), and not `git commit-tree`.
// shortcut: a commit inside `bash -c "…"`, `$(…)` or a git alias is not seen; parse those if
// one turns up in practice.
//
// Exit 2 blocks the call and shows stderr to Claude. Anything this hook can't read lets the
// call through: the gate guards Claude's commits, and the secrets guard is a separate hook.
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { checkoutTop, configFor, hookInput, noticeOnce } from "../lib/config.mjs";
import { docsCheck } from "../lib/docs.mjs";
import { gateCommands, isTrusted, untrusted } from "../lib/trust.mjs";

// The gate's total time, under the 600-second ceiling hooks.json sets.
const BUDGET_MS = 570_000;
// zsh's (P) and (f) flags, alone or with others such as (@f), then the parameter they apply to: a
// `${(` in a Python or JavaScript string, such as `${(n).toFixed(2)}`, is not zsh and passes.
const ZSH = /\$\{\([^)]*[Pf][^)]*\)[A-Za-z_@*#"$]/;
const WRAPPERS = new Set(["command", "env", "exec", "nohup", "time"]);
// git's global options that take the next word as their value.
const GIT_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env", "--super-prefix"]);

let input;
try {
  input = hookInput();
} catch {
  process.exit(0);
}
const { payload } = input;
const command = payload?.tool_input?.command;
if (typeof command !== "string") process.exit(0);
const powershell = payload?.tool_name === "PowerShell";

if (!powershell && ZSH.test(command)) {
  process.stderr.write(
    "Blocked: zsh's (P) and (f) expansion flags stall on Claude Code's safety check. " +
      'Test a variable with [ -n "$NAME" ], one name at a time.\n',
  );
  process.exit(2);
}

// The simple commands in a shell string, each as its words with quotes removed.
function simpleCommands(text) {
  // A heredoc body is data: keep the line that opens it, drop the body and its end line.
  const body = /((?<!<)<<-?[ \t]*(['"]?)([A-Za-z_]\w*)\2[^\n]*)\n(?:[^\n]*\n)*?[ \t]*\3[ \t]*(?=\n|$)/g;
  const src = powershell ? text : text.replace(body, "$1").replace(/\\\r?\n/g, "");
  const escape = powershell ? "`" : "\\";
  const commands = [];
  let words = [];
  let word = null;
  let quote = null;
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endCommand = () => {
    endWord();
    if (words.length) commands.push(words);
    words = [];
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === escape && quote === '"') word += src[++i] ?? "";
      else word += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      word ??= "";
    } else if (c === escape) word = (word ?? "") + (src[++i] ?? "");
    else if (/[;&|()\n`]/.test(c)) endCommand();
    else if (/\s/.test(c)) endWord();
    else if (c === "#" && word === null) {
      while (i + 1 < src.length && src[i + 1] !== "\n") i++; // a comment, to the line's end
    } else word = (word ?? "") + c;
  }
  endCommand();
  return commands;
}

// -> the folder each `git commit` in the command runs in.
function commitFolders(cwd) {
  const folders = [];
  for (const words of simpleCommands(command)) {
    let i = 0;
    while (i < words.length && (/^[A-Za-z_]\w*=/.test(words[i]) || WRAPPERS.has(words[i]))) i++;
    if (!/^git(?:\.exe)?$/i.test((words[i] ?? "").split(/[\\/]/).pop())) continue;
    let dir = cwd;
    for (i++; i < words.length && words[i].startsWith("-"); i++) {
      if (words[i] === "-C") dir = path.resolve(dir, words[i + 1] ?? "");
      if (GIT_VALUE.has(words[i])) i++;
    }
    if (words[i] === "commit") folders.push(dir);
  }
  return folders;
}

// Runs one stage from the repo root. -> null when it passed, else its output.
function runStage(cmd, root, deadline) {
  const left = deadline - Date.now();
  if (left <= 0) return "did not run: the gate's time ran out";
  const run = spawnSync(cmd, { cwd: root, shell: true, encoding: "utf8", timeout: left, maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return run.error.code === "ETIMEDOUT" ? "did not finish in the gate's time" : `did not run (${run.error.code})`;
  if (run.status === 0) return null;
  return `${run.stdout ?? ""}${run.stderr ?? ""}`.trim() || `exited ${run.status}`;
}

// The end of a stage's output, where a test runner or a compiler prints its summary.
const tail = (text) => text.split(/\r?\n/).slice(-15).join("\n").slice(-1500);

const cwd = typeof payload.cwd === "string" ? payload.cwd : process.cwd();
const roots = new Set();
for (const folder of commitFolders(cwd)) {
  let real;
  try {
    real = realpathSync.native(folder);
  } catch {
    continue; // git itself says the folder is missing
  }
  // The session's repo or a linked worktree of it; a commit into another repo is that repo's own.
  const forDir = configFor(real, input);
  if (forDir === input && checkoutTop(real) !== checkoutTop(input.root ?? "")) continue;
  if (forDir.notice) noticeOnce(payload, forDir.notice);
  const { root, config } = forDir;
  if (roots.has(root)) continue;
  roots.add(root);

  const commands = gateCommands(config);
  if (commands.length === 0) continue;
  if (!commands.every((c) => isTrusted(root, c))) {
    noticeOnce(payload, untrusted("The commit gate (gate.stages in .claude/odyssey.json)", root));
    continue;
  }

  const deadline = Date.now() + BUDGET_MS;
  const failed = [];
  for (const { name, command: cmd } of config.gate.stages) {
    const out = runStage(cmd, root, deadline);
    if (out !== null) failed.push([name, out]);
  }
  const docs = docsCheck(root, config, homedir());
  const kitDocs = docs.errors ? docs.text.split("\n").filter((line) => /(?:^| )error: |^docs check: /.test(line)).join("\n") : null;
  const repoDocs = config.docs?.check ? runStage(config.docs.check, root, deadline) : null;
  if (kitDocs !== null || repoDocs !== null) failed.push(["docs", [kitDocs, repoDocs].filter(Boolean).join("\n")]);

  if (failed.length) {
    const report = failed.map(([name, out]) => `--- ${name} ---\n${tail(out)}`).join("\n");
    // No process.exit after this write: it could cut the report short in the pipe.
    process.stderr.write(
      `Commit blocked: the repo's gate failed ${failed.length} of ${config.gate.stages.length + 1} stages ` +
        `(${failed.map(([name]) => name).join(", ")}). Fix them, then commit again.\n${report.slice(-8000)}\n`,
    );
    process.exitCode = 2;
    break;
  }
}
