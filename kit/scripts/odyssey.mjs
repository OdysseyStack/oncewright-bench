#!/usr/bin/env node
// The kit's one script. Run it from inside the project:
//   config          print the resolved config as JSON: { root, file, config, notice }.
//                   Skills call it; agents get the values from their caller.
//   plan            /odyssey:setup's dry run: what apply would write and why, and the diff
//                   of each kit-owned file edited since setup.
//   apply           write it: create-only, except upgrades to kit-owned files and the missing
//                   .gitignore lines. Both take --answers <file>, the interview's answers,
//                   and --approve <path>, repeatable, to replace an edited kit-owned file
//                   or restore a deleted one.
//   status          the hooks on here, their trust, the config version, the kit-owned
//                   files' state, and copied-kit hooks still wired in .claude/settings.json.
//   doctor          Node, the config against the bundled schema, what each switched-on hook
//                   needs (the gate's command, the folders srcDirs and testDirs name,
//                   Prettier for formatOnEdit, trust for each command it runs), settings
//                   that turn the hooks off, and a
//                   canary each switched-on guard must block.
//   trust approve   trust the commands this repo's config switches on that run code.
//                   Run it yourself, in a terminal or with `!` in a session.
//   trust revoke    drop every trusted command for this repo.
//   trust list      list every trusted command, across repos.
//   docs check      list the instruction files with when Claude Code loads each, and what
//                   the load log saw, then check their claims against the repo: each `@`
//                   import names a file, named paths exist, `npm run` names a script, cited
//                   ADRs exist, and no personal skill shadows a repo skill (lib/docs.mjs).
//   bar status      whether the user's settings run the status bar (scripts/statusline.mjs,
//                   copied to ~/.claude/odyssey-statusline.mjs), and whether that copy is
//                   this kit version's.
//   bar install     copy the bar there and name it for statusLine and subagentStatusLine in
//                   ~/.claude/settings.json, keeping a status line already set in front of it.
//   bar remove      put back the status line kept in front, take the bar out of both settings,
//                   and delete its two files.
//   tips status     whether the user's settings hold the kit's spinner tips.
//   tips install    add the kit's tips to them, or bring them up to this kit version's.
//   tips remove     take the kit's tips out of them, keeping the user's own.
//   mod status <mod>
//                   whether the user's settings load a mod, peek or wrap-up (mods/<mod>,
//                   copied to ~/.claude/odyssey-<mod>), and whether that copy is this kit
//                   version's.
//   mod install <mod>
//                   copy the mod there, peek with the secrets guard whose patterns it reads,
//                   and name the folder in CLAUDE_CODE_PLUGIN_DIRS in ~/.claude/settings.json.
//   mod remove <mod>
//                   take the folder out of that list, and delete the folder.
//   launcher status the commands that launch this repo (scripts/launch.mjs).
//   launcher install <name>
//                   copy the launcher to ~/.claude/odyssey-launch.mjs and write <name> to
//                   ~/.local/bin: it opens this repo in Claude Code, and after each wrap-up
//                   starts the next session with /odyssey:handoff. Refuses a name already taken.
//   launcher remove <name>
//                   delete that command, when it is this repo's launcher.
//   next            make-a-path's answer: where the repo stands and the next step, by rules,
//                   first match wins (lib/threads.mjs). --compacted when the session was
//                   compacted, --pr-open when the branch has an open pull request, --json.
//   open            what-next's list: every open thread, with the file it came from. --json.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { SCHEMA, check, repoDir, resolveConfig } from "../lib/config.mjs";
import { configuredCommands, gateCommands, isTrusted, loadTrust, localBin, trustFile, trustKey, updateTrust } from "../lib/trust.mjs";
import { docsCheck } from "../lib/docs.mjs";
import { hereLine, nextStep, openThreads } from "../lib/threads.mjs";
import { HANDOFF, WORKING, slotState } from "../lib/handoff.mjs";
import { STAMP } from "../lib/stamp.mjs";

const USAGE =
  "Usage: odyssey.mjs config | plan [--answers <file>] [--approve <path>]... | " +
  "apply [--answers <file>] [--approve <path>]... | status | doctor | trust approve | trust revoke | trust list | docs check | " +
  "bar status | bar install | bar remove | tips status | tips install | tips remove | " +
  "mod status|install|remove peek|wrap-up | launcher status | launcher install|remove <name> | next [--compacted] [--pr-open] [--json] | open [--json]";
const SCRIPT = fileURLToPath(import.meta.url);
const PLUGIN = path.dirname(path.dirname(SCRIPT));
const SCAFFOLD = path.join(PLUGIN, "scaffold");
const VERSION = JSON.parse(readFileSync(path.join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8")).version;
const APPROVE = `node "${SCRIPT}" trust approve`;
const OLD_NODE =
  Number(process.versions.node.split(".")[0]) < 22
    ? `Odyssey needs Node.js 22 or later, and this is ${process.versions.node}. Install Node 22 or ` +
      "later (https://nodejs.org), then run /odyssey:setup again."
    : "";

// Kit-owned files: copied from scaffold/ byte for byte under a stamp line, and upgraded by
// re-running setup. The handoff slot is copied once, unstamped: skills rewrite it every
// cycle. The .gitignore lines keep the kit's working files out of commits: the handoff and the
// review files.
const KIT_RULES = readdirSync(path.join(SCAFFOLD, ".claude", "rules", "odyssey"))
  .filter((name) => name.endsWith(".md"))
  .sort()
  .map((name) => `.claude/rules/odyssey/${name}`);
// Rule files earlier versions installed: removed on a re-run when untouched, kept when edited.
const RETIRED_RULES = ["code_editing_boundary.md", "git_approval_workflow.md", "no_assumptions_without_directives.md", "production_design_only.md", "scope_containment.md"]
  .map((name) => `.claude/rules/odyssey/${name}`);
const SLOTS = [HANDOFF];
const IGNORED = WORKING;
// The work-order folder earlier versions installed: removed on a re-run when it holds only its
// placeholder (nothing but whitespace and comments), kept when it holds anything else.
const RETIRED_ORDERS = "directives/layer_3_work_orders";
// Config keys earlier versions read: still valid in the schema, removed from the config on a re-run.
const RETIRED_KEYS = ["reviewers", "layer2Owned"];

// The interview's answers, as /odyssey:setup writes them: `config` holds .claude/odyssey.json's
// keys, and the other two become the project rules.
const LIST = { type: "array", items: { type: "string", minLength: 1 } };
const ANSWERS = {
  type: "object",
  additionalProperties: false,
  properties: {
    config: { type: "object" },
    sensitiveData: {
      type: "object",
      additionalProperties: false,
      properties: { identifiers: LIST, freeText: LIST, payloads: LIST, credentials: LIST },
    },
    hotPath: { type: "object", additionalProperties: false, properties: { paths: LIST, invariants: LIST } },
  },
};

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const rel = (root, file) => path.relative(root, file).split(path.sep).join("/");

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null; // missing or unreadable
  }
}

// The stamp hashes the rest of the file with its line endings normalized, so a checkout
// that converts them still reads as untouched. lib/stamp.mjs reads the line back.
const sha256 = (text) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
const stamped = (rest) =>
  `<!-- odyssey-managed v${VERSION} sha256:${sha256(rest)} -->${rest.includes("\r\n") ? "\r\n" : "\n"}${rest}`;

// A kit-owned file in the repo: missing; unstamped (its first line is no longer the stamp, so
// it is the user's); edited (the rest no longer matches the stamp's hash); current; or
// outdated (untouched, and the plugin's copy differs).
function kitState(file, kit) {
  if (!existsSync(file)) return { state: "missing" };
  const text = readFileSync(file, "utf8");
  const cut = text.indexOf("\n");
  const [, version, hash] = STAMP.exec(cut < 0 ? text : text.slice(0, cut)) ?? [];
  if (!hash) return { state: "unstamped" };
  const rest = cut < 0 ? "" : text.slice(cut + 1);
  if (hash !== sha256(rest)) return { state: "edited", version };
  return { state: sha256(rest) === sha256(kit) ? "current" : "outdated", version };
}

// The project rules, written once from the answers and never changed by setup.
const bullets = (items, none = "None named.") =>
  (items?.length ? items : [none]).map((item) => `- ${item.replace(/\s+/g, " ").trim()}`).join("\n");

const sensitiveData = ({ identifiers, freeText, payloads, credentials }) => `# Sensitive data

What this project treats as sensitive, by category and field name, never by value. Logs carry
structural fields only (event names, opaque correlation ids, lengths, counts, statuses,
durations), never these.

## End-user identifiers

${bullets(identifiers)}

## Free-text content

${bullets(freeText)}

## External request/response payloads

${bullets(payloads)}

## Credentials

Where they live, as file names and variable names, never a value:

${bullets(credentials, "Not named: the usual places are `.env` files and the shell's environment.")}

A value that reaches the transcript must be rotated, so never print one:

- Don't \`cat\`, \`sed\` or \`grep\` a file that holds one; count a name: \`grep -c '^NAME=' <file>\`.
- Test a variable with \`[ -n "$NAME" ] && echo set\`; \`\${NAME:-UNSET}\` prints it.
- Report a secret's length and whether it parses, never any part of it (a prefix included),
  nor of a response that echoes one.
`;

const hotPath = ({ paths, invariants }) => `---
paths:
${paths.map((glob) => `  - ${JSON.stringify(glob)}`).join("\n")}
---

# Hot path

The files these \`paths:\` match are this project's latency-critical path. Each change to them
keeps the invariants below, which are this project's canonical pipeline.

## Invariants

${bullets(invariants)}
`;

const PROJECT_FILES = [
  ".claude/odyssey.json",
  ".claude/rules/sensitive-data.md",
  ".claude/rules/hot-path.md",
];

// -> [file, text or null, why a null is skipped], for each of PROJECT_FILES in order. The
// config gets its $schema and version here.
function projectFiles(answers) {
  const { $schema, version, ...rest } = answers.config ?? {};
  const config = { $schema: SCHEMA.$id, version: 1, ...rest };
  const problem = check(SCHEMA, config, "");
  if (problem) fail(`Odyssey: the config these answers make is invalid (${problem}).`);
  const data = answers.sensitiveData ?? {};
  const named = Object.values(data).some((list) => list.length > 0);
  const hot = answers.hotPath?.paths?.length ? hotPath(answers.hotPath) : null;
  return [
    [".claude/odyssey.json", `${JSON.stringify(config, null, 2)}\n`],
    [".claude/rules/sensitive-data.md", named ? sensitiveData(data) : null, "nothing sensitive named"],
    [".claude/rules/hot-path.md", hot, "no hot path named"],
  ];
}

function loadAnswers(file) {
  if (file === undefined) return null;
  const answers = readJson(file);
  if (answers === null) fail(`Odyssey: the answers file ${file} is missing or is not JSON.`);
  const problem = check(ANSWERS, answers, "");
  if (problem) fail(`Odyssey: the answers in ${file} are invalid (${problem}).`);
  return answers;
}

// What setup does in `root`, one step per file: create, replace, append, keep or skip.
// Without answers (a re-run that only upgrades), the project files are left out.
function initSteps(root, answers, approve) {
  const steps = [];
  const step = (file, action, why, text) => steps.push({ file, action, why, text });

  // A deleted kit-owned file is offered back: on a first run nothing exists yet, so
  // everything is created; on a re-run a missing file comes back only with --approve.
  // ponytail: a kit-owned file new in a later release reads as deleted on a re-run and
  // waits for --approve; record what was installed if a release adds one.
  const firstRun = !existsSync(path.join(root, ".claude", "rules", "odyssey"));
  const approvable = [];
  const pending = []; // edited and not approved: plan shows each one's diff
  for (const file of KIT_RULES) {
    const kit = readFileSync(path.join(SCAFFOLD, file), "utf8");
    const { state, version } = kitState(path.join(root, file), kit);
    const approved = approve.includes(file);
    if ((state === "missing" && !firstRun) || state === "edited") approvable.push(file);
    if (state === "edited" && !approved) pending.push([file, stamped(kit)]);
    if (state === "missing" && firstRun) step(file, "create", `kit-owned, stamped v${VERSION}`, stamped(kit));
    else if (state === "missing" && approved) step(file, "create", "deleted since setup, restored on approval", stamped(kit));
    else if (state === "missing") step(file, "skip", `deleted since setup: restore it with --approve ${file}`);
    else if (state === "unstamped") step(file, "keep", "its stamp line is removed, so it is yours");
    else if (state === "edited" && approved) step(file, "replace", "edited since setup, replaced on approval", stamped(kit));
    else if (state === "edited") step(file, "keep", `edited since setup: replace it with --approve ${file}`);
    else if (state === "outdated") step(file, "replace", `untouched, stamped v${version}: this kit is v${VERSION}`, stamped(kit));
    else step(file, "keep", "up to date");
  }
  for (const file of RETIRED_RULES) {
    const { state } = kitState(path.join(root, file), "");
    if (state === "current" || state === "outdated") step(file, "remove", "retired by the kit, and untouched");
    else if (state !== "missing") step(file, "keep", "retired by the kit, but yours now: delete it when you're ready");
  }
  const stray = approve.filter((file) => !approvable.includes(file));
  if (stray.length) {
    fail(`Odyssey: nothing to approve at ${stray.join(", ")}: --approve takes an edited or a deleted kit-owned file.`);
  }

  const orders = path.join(root, RETIRED_ORDERS);
  if (existsSync(orders)) {
    let entries = [];
    try {
      entries = readdirSync(orders);
    } catch {
      // Not a folder that can be read: kept.
    }
    if (entries.length === 1 && entries[0] === "current.md" && slotState(path.join(orders, "current.md")) === "empty") {
      step(`${RETIRED_ORDERS}/`, "remove", "retired by the kit, and holds only its placeholder");
    } else step(`${RETIRED_ORDERS}/`, "keep", "retired by the kit, but it holds work orders or your files: delete it when you're ready");
  }

  for (const file of SLOTS) {
    if (existsSync(path.join(root, file))) step(file, "keep", "exists");
    else step(file, "create", "the empty slot", readFileSync(path.join(SCAFFOLD, file), "utf8"));
  }

  const rendered = answers ? projectFiles(answers) : PROJECT_FILES.map((file) => [file]);
  for (const [file, text, none] of rendered) {
    const config = file === ".claude/odyssey.json" ? readJson(path.join(root, file)) : null;
    const retired = RETIRED_KEYS.filter((key) => config && typeof config === "object" && Object.hasOwn(config, key));
    if (retired.length) {
      const kept = Object.fromEntries(Object.entries(config).filter(([key]) => !retired.includes(key)));
      step(file, "replace", `${retired.join(" and ")} retired by the kit, so removed; nothing else changes`, `${JSON.stringify(kept, null, 2)}\n`);
    } else if (existsSync(path.join(root, file))) step(file, "keep", "exists: setup never changes it");
    else if (!answers) step(file, "skip", "no answers: the interview writes it");
    else if (text === null) step(file, "skip", none);
    else step(file, "create", "from your answers", text);
  }

  const gitignore = path.join(root, ".gitignore");
  const current = existsSync(gitignore) ? readFileSync(gitignore, "utf8") : null;
  const have = new Set((current ?? "").split("\n").map((line) => line.trim()));
  const missing = IGNORED.filter((line) => !have.has(line));
  if (missing.length === 0) step(".gitignore", "keep", "has the kit's lines");
  else {
    const lead = current && !current.endsWith("\n") ? "\n" : "";
    const text = lead + missing.map((line) => `${line}\n`).join("");
    step(".gitignore", current === null ? "create" : "append", missing.join(", "), text);
  }
  return { steps, pending };
}

// What --approve would change in a kit-owned file the user edited: theirs, then the kit's.
function diff(root, file, text) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "odyssey-diff-"));
  try {
    const name = path.basename(file);
    mkdirSync(path.join(dir, "yours"));
    mkdirSync(path.join(dir, "kit"));
    writeFileSync(path.join(dir, "yours", name), readFileSync(path.join(root, file)));
    writeFileSync(path.join(dir, "kit", name), text);
    // git exits 1 when the files differ; the diff is on stdout either way.
    const args = ["diff", "--no-index", "--no-color", "--", `yours/${name}`, `kit/${name}`];
    const run = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    return run.error ? `(no diff: git did not run, ${run.error.code})` : run.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// -> false when a create finds something already there, such as a dangling link: it is
// kept, and never written through.
function write(root, { file, action, text }) {
  const target = path.join(root, file);
  if (action === "create") {
    mkdirSync(path.dirname(target), { recursive: true });
    // A link that exists, dangling or not, is kept: Windows would follow it on a create-only open.
    try { lstatSync(target); return false; } catch { /* nothing there: create it */ }
    let fd;
    try {
      fd = openSync(target, "wx"); // create-only: never overwrites
    } catch (err) {
      if (err.code === "EEXIST") return false;
      throw err;
    }
    try {
      writeFileSync(fd, text);
    } finally {
      closeSync(fd);
    }
  } else if (action === "replace") writeFileSync(target, text);
  else if (action === "append") appendFileSync(target, text);
  else if (action === "remove") rmSync(target, { recursive: file.endsWith("/") });
  return true;
}

// Why a srcDirs or testDirs entry matches no file, or "" when it names a folder in the repo the
// way the hooks read it: a path from the root, spelled as the file system
// spells it.
function dirProblem(root, entry) {
  const dir = repoDir(entry);
  if (path.isAbsolute(dir)) return "which is not a path from the repo root";
  let real;
  try {
    real = realpathSync.native(path.join(root, dir));
  } catch {
    return "which is no folder in the repo";
  }
  if (!statSync(real).isDirectory()) return "which is no folder in the repo";
  const onDisk = rel(root, real);
  if (onDisk === ".." || onDisk.startsWith("../") || path.isAbsolute(onDisk)) return "which leads outside the repo";
  return onDisk === dir ? "" : `which is "${onDisk}" on disk`;
}

// A call each switched-on guard must block (exit 2): the cases protect-env's own tests pin,
// and one per opt-in guard. Paths point into `dir`. -> [guard, tool, input, what]
function canaries(config, dir) {
  const at = (name) => path.join(dir, name);
  const list = [
    ["protect-env", "Write", { file_path: at(".env"), content: "x" }, "a Write to .env"],
    ["protect-env", "Bash", { command: "echo x > .env" }, "echo x > .env in Bash"],
    ["protect-env", "mcp__filesystem__write_file", { path: at(".env"), content: "x" }, "an MCP write_file to .env"],
    ["protect-managed", "Edit", { file_path: at("stamped.md"), old_string: "kit", new_string: "ours" }, "an Edit to a stamped file"],
    ["bash-guard", "Bash", { command: 'echo "${(P)name}"' }, "a zsh (P) expansion in Bash"],
  ];
  if (config.hooks?.protectManifest === true) {
    const name = config.protect?.manifests?.[0] ?? "package.json";
    list.push(["protect-manifest", "Write", { file_path: at(name), content: "{}" }, `a Write to ${name}`]);
  }
  if (config.hooks?.protectAppendOnly === true) {
    const name = config.protect?.readOnly?.[0] ?? config.protect?.appendOnly?.[0];
    list.push(["protect-append-only", "Write", name && { file_path: at(name), content: "x" }, `a Write to ${name}`]);
  }
  return list;
}

// Runs a guard the way hooks/hooks.json wires it for `tool`. -> "" when it blocks, else why not.
function runCanary(root, guard, tool, input, what) {
  const hooks = (readJson(path.join(PLUGIN, "hooks", "hooks.json"))?.hooks?.PreToolUse ?? [])
    .filter((group) => new RegExp(`^(?:${group.matcher})$`).test(tool))
    .flatMap((group) => group.hooks ?? [])
    .filter((hook) => path.basename(hook.args?.[0] ?? "") === `${guard}.mjs`);
  if (hooks.length === 0) return `${guard} is not wired for ${tool} in hooks/hooks.json, so nothing blocks ${what}`;
  for (const hook of hooks) {
    const run = spawnSync(process.execPath, hook.args.map((arg) => arg.replaceAll("${CLAUDE_PLUGIN_ROOT}", PLUGIN)), {
      input: JSON.stringify({ session_id: "odyssey-doctor", tool_name: tool, tool_input: input }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_ROOT: PLUGIN },
      encoding: "utf8",
      timeout: 10_000,
    });
    if (run.status !== 2) return `${guard} did not block ${what} (${run.error?.code ?? `exit ${run.status}`})`;
  }
  return "";
}

// Copied-kit hooks still wired in a settings file: each runs twice beside the plugin's.
const KIT_HOOK = /\b(?:protect-(?:env|managed|manifest|append-only)|post-edit|format-on-edit|esm-import-extension|typecheck-gate)\.mjs\b/;
function wiredKitHooks(file) {
  const lines = [];
  for (const [event, groups] of Object.entries(readJson(file)?.hooks ?? {})) {
    for (const group of Array.isArray(groups) ? groups : []) {
      for (const hook of group.hooks ?? []) {
        const command = [hook.command, ...(hook.args ?? [])].join(" ");
        lines.push(`${event}${group.matcher ? ` ${group.matcher}` : ""}: ${command}`);
      }
    }
  }
  return lines.filter((line) => KIT_HOOK.test(line));
}

// The status bar and the spinner tips: /odyssey:setup's two offers for the user's own settings,
// outside the repo. An edit keeps everything else in the file, and the first one saves the file
// as it was beside it. A settings file that isn't a JSON object is left alone.
// Claude Code keeps the user's settings in CLAUDE_CONFIG_DIR when it is set; the trust file stays in ~/.claude.
const claudeHome = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const userSettings = () => path.join(claudeHome(), "settings.json");
const barFile = () => path.join(claudeHome(), "odyssey-statusline.mjs");
const barPrev = () => path.join(claudeHome(), "odyssey-statusline.prev");
const BAR_SOURCE = path.join(PLUGIN, "scripts", "statusline.mjs");
// Forward slashes and quotes: on Windows Claude Code runs a status line through Git Bash, which
// reads a backslash as an escape, or PowerShell.
const barCommand = () => `node "${barFile().split(path.sep).join("/")}"`;
const runsBar = (entry) => typeof entry?.command === "string" && entry.command.includes("odyssey-statusline.mjs");
// -> "missing" | "same" | "differs": the copy in ~/.claude against this kit version's script.
function barScript() {
  try {
    return readFileSync(barFile()).equals(readFileSync(BAR_SOURCE)) ? "same" : "differs";
  } catch {
    return "missing";
  }
}
function readSettings() {
  const file = userSettings();
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    return err.code === "ENOENT" ? { file, settings: {} } : { file, settings: null };
  }
  try {
    const settings = JSON.parse(text);
    if (settings && typeof settings === "object" && !Array.isArray(settings)) return { file, settings };
  } catch {
    // Not JSON: left as it is.
  }
  return { file, settings: null };
}
function writeSettings(file, settings, out) {
  const backup = `${file}.before-odyssey`;
  if (existsSync(file) && !existsSync(backup)) {
    writeFileSync(backup, readFileSync(file));
    out.push(`Saved your settings as they were to ${backup}.`);
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}
const TIPS = [
  {
    id: "odyssey-wrap-up",
    text: "Ending a session? /odyssey:wrap-up saves what this session decided and learned to memory, then writes the next session's handoff.",
  },
  {
    id: "odyssey-heal-me",
    text: "Something broke? /odyssey:heal-me builds a check that fails on the bug, makes the fix with a regression test, and records what was learned.",
  },
  {
    id: "odyssey-status",
    text: "/odyssey:setup status shows which of the kit's hooks are on in this repo, and whether a handoff is waiting.",
  },
  {
    id: "odyssey-cr-triage",
    text: "CodeRabbit reviewed your PR? Run /odyssey:cr-triage with its number: it checks each finding against the code and accepts, rejects or defers it, or reports the PR ready to merge.",
  },
  {
    id: "odyssey-create-directive",
    text: "A process you keep explaining? /odyssey:create-directive writes it down in directives/ from the kit's template: its goal, inputs, outputs, steps and edge cases.",
  },
  {
    id: "odyssey-secrets-guard",
    text: "The kit's secrets guard blocks Claude's writes to .env files, private keys and other secret files. To protect more, add patterns to protect.secrets in .claude/odyssey.json.",
  },
];
const isOurs = (tip) => typeof tip?.id === "string" && tip.id.startsWith("odyssey-");

// The kit's mods, in mods/: each loaded only from a folder that CLAUDE_CODE_PLUGIN_DIRS names, a
// list Claude Code reads at startup and splits on the OS's path separator (`;` on Windows, `:`
// elsewhere). Peek, the experimental file viewer, refuses every file until it can read the
// secrets guard's patterns from the copy beside it; wrap-up, the band past the wrap-up mark,
// needs nothing beside it.
const DIRS = "CLAUDE_CODE_PLUGIN_DIRS";
const GUARD_SOURCE = path.join(PLUGIN, "hooks", "protect-env.mjs");
const MODS = {
  peek: {
    label: "Peek",
    extra: { "protect-env.mjs": GUARD_SOURCE },
    copied: " with the kit's secret-file patterns",
    use: "type /peek in one",
    older: ", so its secret-file patterns may be older",
  },
  "wrap-up": { label: "Wrap-up", extra: {}, copied: "", use: "its band shows once a session passes the wrap-up mark", older: "" },
};
const modSource = (name) => path.join(PLUGIN, "mods", name);
const modDir = (name) => path.join(claudeHome(), `odyssey-${name}`);
// The folders the settings' list names; null when `env` or the list isn't what Claude Code reads.
function dirsOf(settings) {
  const env = settings.env;
  if (env === undefined) return [];
  if (env === null || typeof env !== "object" || Array.isArray(env)) return null;
  const list = env[DIRS];
  if (list === undefined) return [];
  return typeof list === "string" ? list.split(path.delimiter).map((dir) => dir.trim()).filter(Boolean) : null;
}
const isMod = (name) => (dir) => path.resolve(dir.replace(/^~(?=$|[\\/])/, os.homedir())) === modDir(name);
// Every file in a folder, by its path inside it, but `.claude-plugin/types/`, which Claude Code
// writes into a mod's folder when it loads the mod.
const filesIn = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .filter((file) => !file.startsWith(path.join(".claude-plugin", "types") + path.sep))
    .sort();
// -> "missing" | "same" | "differs": the copy in ~/.claude against this kit version's mod and
// the files beside it.
function modCopy(name) {
  let copy;
  try {
    copy = filesIn(modDir(name));
  } catch {
    return "missing";
  }
  const { extra } = MODS[name];
  const kit = [...filesIn(modSource(name)), ...Object.keys(extra)].sort();
  const source = (file) => (Object.hasOwn(extra, file) ? extra[file] : path.join(modSource(name), file));
  const same = copy.length === kit.length && kit.every((file, i) => copy[i] === file && readFileSync(path.join(modDir(name), file)).equals(readFileSync(source(file))));
  return same ? "same" : "differs";
}

// The launcher (scripts/launch.mjs): copied to ~/.claude/odyssey-launch.mjs, and run by a command
// the user names, one per repo, in ~/.local/bin. The command's second line names the repo it opens,
// which is how status and remove tell the kit's launchers from other files there.
const LAUNCH_SOURCE = path.join(PLUGIN, "scripts", "launch.mjs");
const launchFile = () => path.join(claudeHome(), "odyssey-launch.mjs");
const binDir = () => path.join(os.homedir(), ".local", "bin");
const WIN = process.platform === "win32";
const launcherPath = (cmd) => path.join(binDir(), WIN ? `${cmd}.cmd` : cmd);
const LAUNCHER_MARK = "odyssey-launcher: ";
function launcherText(cmd, root) {
  const about = `${cmd}: Claude Code in this repo; after each /odyssey:wrap-up it starts the next session with /odyssey:handoff. Written by /odyssey:setup.`;
  if (WIN) {
    const copy = process.env.CLAUDE_CONFIG_DIR ? launchFile() : "%USERPROFILE%\\.claude\\odyssey-launch.mjs";
    return ["@echo off", `rem ${LAUNCHER_MARK}${root}`, `rem ${about}`, `cd /d "${root}" || exit /b 1`, `node "${copy}" %*`, ""].join("\r\n");
  }
  const quoted = (text) => `'${text.replaceAll("'", "'\\''")}'`;
  return ["#!/bin/sh", `# ${LAUNCHER_MARK}${root}`, `# ${about}`, `cd ${quoted(root)} || exit 1`, `exec node ${quoted(launchFile())} "$@"`, ""].join("\n");
}
// -> the repo a file in ~/.local/bin opens, or null when the kit didn't write it.
function launcherRoot(file) {
  try {
    const line = readFileSync(file, "utf8").split(/\r?\n/)[1] ?? "";
    const at = line.indexOf(LAUNCHER_MARK);
    return at < 0 ? null : line.slice(at + LAUNCHER_MARK.length);
  } catch {
    return null;
  }
}
function launchersFor(root) {
  try {
    return readdirSync(binDir()).filter((f) => launcherRoot(path.join(binDir(), f)) === root).map((f) => f.replace(/\.cmd$/, "")).sort();
  } catch {
    return [];
  }
}
// Where the user's shell finds `cmd` now (an alias or function in their startup file counts), or "".
// The name is checked against LAUNCHER_NAME first, so it is safe in the command line. Only the
// @@ line counts: a startup file may print (macOS Terminal's "Restored session: …"). No $( ), which
// fish before 3.4 can't parse: the probe would print nothing, and a taken name would pass as free.
function onPath(cmd) {
  const [bin, argv] = WIN ? ["where", [cmd]] : [process.env.SHELL || "sh", ["-ic", `command -v ${cmd} >/dev/null && printf '@@' && command -v ${cmd}`]];
  const out = spawnSync(bin, argv, { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).stdout ?? "";
  const lines = out.split(/\r?\n/).map((line) => line.trim());
  return (WIN ? lines.find(Boolean) : lines.find((line) => line.startsWith("@@"))?.slice(2)) ?? "";
}
const LAUNCHER_NAME = /^[a-z][a-z0-9-]{0,30}$/;
// The line that puts ~/.local/bin on the PATH for the user's shell (macOS Terminal starts bash as a
// login shell, which reads ~/.bash_profile).
function addToPath(file) {
  const shell = path.basename(process.env.SHELL ?? "");
  const rc = { zsh: "~/.zshrc", bash: process.platform === "darwin" ? "~/.bash_profile" : "~/.bashrc" }[shell] ?? "~/.profile";
  const line = shell === "fish" ? "fish_add_path ~/.local/bin" : `echo 'export PATH="$HOME/.local/bin:$PATH"' >> ${rc}`;
  return `${binDir()} isn't on your PATH. Add it with this line, then open a new terminal:\n  ${line}\nUntil then, run ${file}.`;
}

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      answers: { type: "string" },
      approve: { type: "string", multiple: true, default: [] },
      compacted: { type: "boolean", default: false },
      "pr-open": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
  });
} catch (err) {
  fail(`${err.message}\n${USAGE}`);
}
const [command, action, name] = args.positionals;

if (command === "config") {
  process.stdout.write(`${JSON.stringify(resolveConfig(), null, 2)}\n`);
} else if (command === "plan" || command === "apply") {
  if (OLD_NODE) fail(OLD_NODE);
  const { root, notice } = resolveConfig();
  if (!existsSync(path.join(root, ".git"))) {
    fail(`Odyssey: run /odyssey:setup at the root of a git repo; ${root} is not one.`);
  }
  const answers = loadAnswers(args.values.answers);
  const approve = args.values.approve.map((file) => file.replaceAll("\\", "/").replace(/^\.\//, ""));
  const { steps, pending } = initSteps(root, answers, approve);
  const PAST = { create: "created", replace: "replaced", append: "appended", remove: "removed", keep: "kept", skip: "skipped" };
  const out = [command === "plan" ? `Dry run in ${root}: nothing is written until you apply.` : `Applied in ${root}:`];
  if (notice) out.push(notice);
  if (command === "apply") {
    for (const s of steps) if (!write(root, s)) Object.assign(s, { action: "keep", why: "exists: setup never changes it" });
  }
  for (const s of steps) {
    out.push(`  ${(command === "plan" ? s.action : PAST[s.action]).padEnd(8)} ${s.file}  (${s.why})`);
  }
  const count = (...actions) => steps.filter((s) => actions.includes(s.action)).length;
  const writes = count("create", "replace", "append", "remove");
  out.push(`${writes} ${command === "plan" ? "to write" : "written"}, ${count("keep")} kept, ${count("skip")} skipped.`);
  if (command === "plan" && pending.length) {
    out.push("", "What --approve would change in each edited file:");
    for (const [file, text] of pending) out.push("", `${file}:`, diff(root, file, text).trimEnd());
  }
  if (command === "apply") {
    const untrusted = configuredCommands(resolveConfig(root).config).filter((c) => !isTrusted(root, c));
    if (untrusted.length) {
      out.push(
        "",
        "These hooks run code, so they stay off until you trust them:",
        ...untrusted.map((c) => `  ${c}`),
        `Run this yourself in ${root}, in a terminal or with ! in the session:`,
        `  ${APPROVE}`,
      );
    }
  }
  process.stdout.write(`${out.join("\n")}\n`);
} else if (command === "status") {
  const { root, file, config, notice } = resolveConfig();
  const out = [`Odyssey status in ${root}`];
  if (notice) out.push(`Config: ${notice}`);
  else if (file) out.push(`Config: ${rel(root, file)}, version ${config.version}.`);
  else out.push("Config: none, so every skill and hook runs on its defaults; /odyssey:setup writes one.");
  const on = Object.entries(config.hooks ?? {})
    .filter(([, value]) => value === true || value?.enabled === true)
    .map(([key]) => key);
  if (gateCommands(config).length) on.unshift("the commit gate (from gate.stages)");
  const also = on.length ? `; from the config, ${on.join(", ")}` : "";
  out.push(`Hooks on: the secrets guard, the stamped-file guard and the zsh guard, always${also}.`);
  const commands = configuredCommands(config);
  if (commands.length === 0) out.push("Trust: no hook switched on here runs a command.");
  for (const c of commands) {
    if (isTrusted(root, c)) out.push(`Trusted: ${c}`);
    else out.push(`Not trusted, so it does not run: ${c}. Run this yourself in ${root}: ${APPROVE}`);
  }
  const WORDS = {
    outdated: "out of date: /odyssey:setup upgrades it",
    edited: "edited since setup",
    unstamped: "its stamp line is removed, so it is yours",
    missing: "missing",
  };
  const states = KIT_RULES.map((f) => [f, kitState(path.join(root, f), readFileSync(path.join(SCAFFOLD, f), "utf8")).state]);
  if (states.every(([, state]) => state === "missing")) out.push("Kit-owned rules: none yet; /odyssey:setup writes them.");
  else {
    const current = states.filter(([, state]) => state === "current").length;
    out.push(`Kit-owned rules: ${current} of ${states.length} up to date.`);
    for (const [f, state] of states) if (state !== "current") out.push(`  ${f}: ${WORDS[state]}`);
  }
  const leftovers = wiredKitHooks(path.join(root, ".claude", "settings.json"));
  if (leftovers.length === 0) out.push("Settings: no copied-kit hook is wired in .claude/settings.json; the plugin wires its own.");
  else {
    const hooks = `${leftovers.length} copied-kit hook${leftovers.length === 1 ? "" : "s"}`;
    out.push(`Settings: .claude/settings.json still wires ${hooks}, so each runs twice beside the plugin's. Remove them:`);
    for (const line of leftovers) out.push(`  ${line}`);
  }
  const handoff = slotState(path.join(root, HANDOFF));
  if (handoff === "missing") out.push(`Handoff: ${HANDOFF} is missing; /odyssey:setup writes it.`);
  else if (handoff === "unreadable") out.push(`Handoff: ${HANDOFF} can't be read.`);
  else if (handoff === "empty") out.push("Handoff: none waiting.");
  else out.push("Handoff: a message is waiting; /odyssey:handoff reads it.");
  const launchers = launchersFor(path.resolve(root));
  if (launchers.length) out.push(`Launcher: ${launchers.map((l) => `\`${l}\``).join(", ")} opens this repo, and starts the next session after each wrap-up.`);
  else out.push("Launcher: none; /odyssey:setup makes one, so each session starts the next by itself.");
  process.stdout.write(`${out.join("\n")}\n`);
} else if (command === "doctor") {
  const { root, file, config, notice } = resolveConfig();
  const lines = [];
  const result = (ok, text) => lines.push(`${ok ? "PASS" : "FAIL"} ${text}`);
  result(!OLD_NODE, OLD_NODE || `Node ${process.versions.node}: 22 or later`);
  const valid = file ? `${rel(root, file)} is valid against the bundled schema` : "no .claude/odyssey.json, so the defaults apply";
  result(!notice, notice || valid);
  // A hook switched on with nothing to act on does nothing, and says nothing.
  const gate = config.hooks?.typecheckGate;
  if (gate?.enabled === true) {
    if (gate.command) result(true, "the typecheck gate is on and names its command");
    else result(false, "hooks.typecheckGate is on, but it names no command, so the typecheck gate never runs");
  }
  const entries = [...(config.srcDirs ?? []).map((e) => ["srcDirs", e]), ...(config.testDirs ?? []).map((e) => ["testDirs", e])];
  const wrong = entries.map(([key, entry]) => [key, entry, dirProblem(root, entry)]).filter(([, , why]) => why);
  for (const [key, entry, why] of wrong) result(false, `${key} names ${JSON.stringify(entry)}, ${why}, so no file matches it`);
  if (entries.length && !wrong.length) result(true, "each srcDirs and testDirs entry is a folder in the repo");
  if (config.hooks?.formatOnEdit === true) {
    const prettier = localBin(root, root, "prettier", "bin/prettier.cjs");
    if (prettier) result(true, `formatOnEdit finds Prettier at ${rel(root, prettier)}`);
    else result(false, "hooks.formatOnEdit is on, but no Prettier is installed in node_modules here or in a folder above, up to the git root");
  }
  const commands = configuredCommands(config);
  const untrusted = commands.filter((c) => !isTrusted(root, c));
  for (const c of untrusted) result(false, `not trusted, so it does not run: ${c}. Run this yourself in ${root}: ${APPROVE}`);
  if (commands.length && !untrusted.length) result(true, "each command the switched-on hooks run is trusted");
  const off = [
    userSettings(),
    path.join(root, ".claude", "settings.json"),
    path.join(root, ".claude", "settings.local.json"),
  ].filter((f) => readJson(f)?.disableAllHooks === true);
  if (off.length) result(false, `disableAllHooks is on in ${off.join(" and ")}, so no hook runs`);
  else result(true, "no settings file turns the hooks off");
  const user = readJson(userSettings());
  for (const name of Object.keys(MODS)) {
    if (!dirsOf(user ?? {})?.some(isMod(name))) continue;
    const copy = modCopy(name);
    const at = `your settings load ${name} from ${modDir(name)}`;
    if (copy === "missing") result(false, `${at}, but the folder is missing; /odyssey:setup puts it back`);
    else if (copy === "same") result(true, `${at}, and it matches this kit version's`);
    else result(false, `${at}, a copy that differs from this kit version's${MODS[name].older}; /odyssey:setup replaces it`);
  }
  if (runsBar(user?.statusLine) || runsBar(user?.subagentStatusLine)) {
    const script = barScript();
    if (script === "missing") result(false, `the status bar runs ${barFile()}, but the file is missing; /odyssey:setup puts it back`);
    else if (script === "same") result(true, `the status bar runs ${barFile()}, and it matches this kit version's script`);
    else result(true, `the status bar runs ${barFile()}, a copy that differs from this kit version's; /odyssey:setup replaces it`);
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), "odyssey-doctor-"));
  try {
    writeFileSync(path.join(dir, "stamped.md"), stamped("kit\n"));
    for (const [guard, tool, input, what] of canaries(config, dir)) {
      if (!input) {
        result(false, `${guard} is on, but protect.readOnly and protect.appendOnly list no file, so it guards nothing`);
        continue;
      }
      const why = runCanary(root, guard, tool, input, what);
      result(!why, why || `${guard} blocks ${what}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const failed = lines.filter((line) => line.startsWith("FAIL")).length;
  // exitCode, not process.exit: an exit straight after a long report cuts it short in a pipe.
  process.stdout.write(`Odyssey doctor in ${root}\n${lines.join("\n")}\ndoctor: ${lines.length - failed} PASS, ${failed} FAIL\n`);
  process.exitCode = failed ? 1 : 0;
} else if (command === "trust" && action === "list") {
  let records;
  try {
    records = loadTrust();
  } catch (err) {
    fail(`Odyssey: ${err.message} Until then nothing is trusted.`);
  }
  if (records.length === 0) process.stdout.write(`Nothing is trusted yet (${trustFile()}).\n`);
  for (const record of records) process.stdout.write(`${record.repo}: ${record.command}\n`);
} else if (command === "trust" && (action === "approve" || action === "revoke")) {
  const { root, file, config, notice } = resolveConfig();
  const key = trustKey(root);
  // A trust file that can't be read is left as it is: writing over it would drop every
  // other repo's approvals without a word.
  const update = (change) => {
    try {
      updateTrust((records) => change(records.filter((record) => record.repo !== key)));
    } catch (err) {
      fail(`Odyssey: the trust file was not changed. ${err.message} Then run this again.`);
    }
  };
  if (action === "revoke") {
    // Needs only the root, so an invalid config never blocks withdrawing trust.
    update((others) => others);
    process.stdout.write(`Revoked every trusted command for ${key} and its git worktrees.\n`);
  } else {
    if (notice) fail(notice);
    const commands = configuredCommands(config);
    if (commands.length === 0) {
      const why = file
        ? `${file} switches on no hook that runs a command`
        : `no .claude/odyssey.json applies in ${root}`;
      fail(`Nothing to approve: ${why}.`);
    }
    update((others) => [...others, ...commands.map((trusted) => ({ repo: key, command: trusted }))]);
    process.stdout.write(
      `Trusted in ${key} and its git worktrees:\n${commands.map((trusted) => `  ${trusted}\n`).join("")}` +
        `Recorded in ${trustFile()}. A changed command, or a moved repo, needs approving again.\n`,
    );
  }
} else if (command === "docs" && action === "check") {
  const { root, config, notice } = resolveConfig();
  const { text, errors } = docsCheck(root, config, os.homedir());
  process.stdout.write(`${notice ? `${notice}\n` : ""}${text}\n`);
  process.exitCode = errors ? 1 : 0;
} else if (command === "bar" && action === "status") {
  const { settings } = readSettings();
  const script = barScript();
  if (!runsBar(settings?.statusLine)) process.stdout.write("Status bar: off.\n");
  else if (script === "same") process.stdout.write("Status bar: on.\n");
  else process.stdout.write("Status bar: on; its script differs from this kit version's.\n");
} else if (command === "bar" && action === "install") {
  const { file, settings } = readSettings();
  if (!settings) {
    process.stdout.write(`Status bar: not added. ${file} isn't valid JSON, so it was left as it is; fix it, then run /odyssey:setup again.\n`);
    process.exit(1);
  }
  const script = barScript();
  const wasOn = runsBar(settings.statusLine) && script !== "missing";
  if (script !== "same") {
    mkdirSync(claudeHome(), { recursive: true });
    writeFileSync(barFile(), readFileSync(BAR_SOURCE));
  }
  const out = [];
  let edited = false;
  let prev = "";
  if (!runsBar(settings.statusLine)) {
    prev = typeof settings.statusLine?.command === "string" ? settings.statusLine.command : "";
    writeFileSync(barPrev(), prev ? `${prev}\n` : "");
    settings.statusLine = { type: "command", command: barCommand() };
    edited = true;
  }
  let addedRows = false;
  if (!settings.subagentStatusLine) {
    settings.subagentStatusLine = { type: "command", command: barCommand() };
    edited = addedRows = true;
  }
  const rows = runsBar(settings.subagentStatusLine);
  if (wasOn && script === "same") out.push("Status bar: already on, and its script matches this kit version's.");
  else if (wasOn) out.push(`Status bar: already on; replaced ${barFile()} with this kit version's.`);
  if (wasOn && addedRows) out.push(`Helper-agent rows: added. ${file} now runs ${barFile()} for each helper agent's row too.`);
  if (!wasOn) {
    out.push(`Status bar: on. ${file} now runs ${barFile()} for the status line${rows ? " and for each helper agent's row" : ""}.`);
    if (prev) out.push(`Your previous status line runs in front of it: ${prev}.`);
    if (!rows) out.push("Your own subagentStatusLine is kept, so the helper-agent rows keep its look.");
  }
  if (edited) writeSettings(file, settings, out);
  process.stdout.write(`${out.join("\n")}\n`);
} else if (command === "bar" && action === "remove") {
  const { file, settings } = readSettings();
  if (!settings) {
    process.stdout.write(`Status bar: not removed. ${file} isn't valid JSON, so it was left as it is; fix it, then run this again.\n`);
    process.exit(1);
  }
  const out = [];
  const edited = runsBar(settings.statusLine) || runsBar(settings.subagentStatusLine);
  const prev = runsBar(settings.statusLine) && existsSync(barPrev()) ? readFileSync(barPrev(), "utf8").trim() : "";
  if (prev) settings.statusLine = { type: "command", command: prev };
  else if (runsBar(settings.statusLine)) delete settings.statusLine;
  if (runsBar(settings.subagentStatusLine)) delete settings.subagentStatusLine;
  out.push(edited ? `Status bar: removed from ${file}${prev ? `; your previous status line is back: ${prev}` : ""}.` : "Status bar: already off.");
  if (edited) writeSettings(file, settings, out);
  for (const f of [barFile(), barPrev()]) rmSync(f, { force: true });
  process.stdout.write(`${out.join("\n")}\n`);
} else if (command === "tips" && action === "remove") {
  const { file, settings } = readSettings();
  if (!settings) {
    process.stdout.write(`Spinner tips: not removed. ${file} isn't valid JSON, so it was left as it is; fix it, then run this again.\n`);
    process.exit(1);
  }
  const { tips, ...rest } = settings.spinnerTipsOverride ?? {};
  const out = [];
  if (!Array.isArray(tips) || !tips.some(isOurs)) out.push("Spinner tips: already off.");
  else {
    const kept = tips.filter((tip) => !isOurs(tip));
    if (kept.length || Object.keys(rest).length) settings.spinnerTipsOverride = kept.length ? { ...rest, tips: kept } : rest;
    else delete settings.spinnerTipsOverride;
    out.push(`Spinner tips: removed the kit's tips from ${file}.`);
    writeSettings(file, settings, out);
  }
  process.stdout.write(`${out.join("\n")}\n`);
} else if (command === "tips" && action === "status") {
  const tips = readSettings().settings?.spinnerTipsOverride?.tips;
  const on = Array.isArray(tips) && TIPS.every((tip) => tips.some((entry) => entry?.id === tip.id));
  process.stdout.write(`Spinner tips: ${on ? "on" : "off"}.\n`);
} else if (command === "tips" && action === "install") {
  const { file, settings } = readSettings();
  const override = settings?.spinnerTipsOverride;
  if (!settings) {
    process.stdout.write(`Spinner tips: not added. ${file} isn't valid JSON, so it was left as it is; fix it, then run /odyssey:setup again.\n`);
    process.exit(1);
  }
  if (override !== undefined && (override === null || typeof override !== "object" || Array.isArray(override) || (override.tips !== undefined && !Array.isArray(override.tips)))) {
    process.stdout.write(`Spinner tips: not added. spinnerTipsOverride in ${file} isn't the object Claude Code documents, so it was left as it is.\n`);
    process.exit(1);
  }
  const list = override?.tips ?? [];
  const ours = list.filter(isOurs);
  const current = ours.length === TIPS.length && TIPS.every((tip) => ours.some((e) => e.id === tip.id && e.text === tip.text && Object.keys(e).length === 2));
  const out = [];
  if (current) out.push("Spinner tips: already on.");
  else {
    settings.spinnerTipsOverride = { ...override, tips: [...list.filter((tip) => !isOurs(tip)), ...TIPS] };
    out.push(ours.length ? "Spinner tips: updated the kit's tips to this kit version's." : `Spinner tips: added the kit's tips to ${file}.`);
    writeSettings(file, settings, out);
  }
  process.stdout.write(`${out.join("\n")}\n`);
} else if (command === "mod" && action === "status" && Object.hasOwn(MODS, name ?? "")) {
  const copy = modCopy(name);
  const { label } = MODS[name];
  if (!(dirsOf(readSettings().settings ?? {}) ?? []).some(isMod(name))) process.stdout.write(`${label}: off.\n`);
  else if (copy === "same") process.stdout.write(`${label}: on.\n`);
  else process.stdout.write(`${label}: on; its copy differs from this kit version's.\n`);
} else if (command === "mod" && (action === "install" || action === "remove") && Object.hasOwn(MODS, name ?? "")) {
  const { label, extra, copied, use } = MODS[name];
  const dir = modDir(name);
  const isThis = isMod(name);
  const { file, settings } = readSettings();
  const verb = action === "install" ? "added" : "removed";
  if (!settings) {
    process.stdout.write(`${label}: not ${verb}. ${file} isn't valid JSON, so it was left as it is; fix it, then run this again.\n`);
    process.exit(1);
  }
  const dirs = dirsOf(settings);
  if (!dirs) {
    process.stdout.write(`${label}: not ${verb}. env in ${file} doesn't hold ${DIRS} as one line of folders, so it was left as it is.\n`);
    process.exit(1);
  }
  const wasOn = dirs.some(isThis);
  const out = [];
  if (action === "install") {
    const copy = modCopy(name);
    if (copy !== "same") {
      rmSync(dir, { recursive: true, force: true });
      cpSync(modSource(name), dir, { recursive: true });
      for (const [to, from] of Object.entries(extra)) writeFileSync(path.join(dir, to), readFileSync(from));
    }
    if (wasOn && copy === "same") out.push(`${label}: already on, and its copy matches this kit version's.`);
    else if (wasOn) out.push(`${label}: already on; replaced ${dir} with this kit version's, for sessions started from now on.`);
    else {
      // Claude Code takes the settings' list over the one in the environment it starts from.
      const outside = settings.env?.[DIRS] === undefined ? (process.env[DIRS] ?? "").split(path.delimiter).map((d) => d.trim()).filter(Boolean) : [];
      settings.env = { ...settings.env, [DIRS]: [...dirs, dir].join(path.delimiter) };
      out.push(
        `${label}: on. Copied it to ${dir}${copied}, and ${file} now names that folder in ${DIRS}, ` +
          `so Claude Code sessions started from now on load it; ${use}.`,
      );
      if (outside.length) {
        out.push(`Your environment also sets ${DIRS}, to ${outside.join(", ")}. The list in your settings now takes its place, so add those folders to it to keep them.`);
      }
      writeSettings(file, settings, out);
    }
  } else {
    const there = existsSync(dir);
    if (wasOn) {
      const rest = dirs.filter((d) => !isThis(d));
      if (rest.length) settings.env[DIRS] = rest.join(path.delimiter);
      else delete settings.env[DIRS];
    }
    rmSync(dir, { recursive: true, force: true });
    if (!wasOn && !there) out.push(`${label}: already off.`);
    else {
      const did = [wasOn && `took ${dir} out of ${DIRS} in ${file}`, there && `deleted ${dir}`].filter(Boolean);
      out.push(`${label}: off. ${did.join(" and ").replace(/^./, (c) => c.toUpperCase())}; Claude Code sessions started from now on start without it.`);
    }
    if (wasOn) writeSettings(file, settings, out);
  }
  process.stdout.write(`${out.join("\n")}\n`);
} else if (command === "launcher" && ["status", "install", "remove"].includes(action)) {
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).stdout?.trim();
  if (!top) fail("Odyssey: run this inside a git repo; the launcher opens the repo it was made in.");
  const root = path.resolve(top);
  const mine = launchersFor(root);
  let copy = "missing";
  try {
    copy = readFileSync(launchFile()).equals(readFileSync(LAUNCH_SOURCE)) ? "same" : "differs";
  } catch {
    // Not copied yet.
  }
  if (action === "status") {
    const note = copy === "same" ? "" : copy === "missing" ? `; ${launchFile()} is missing, so it can't start` : "; its script differs from this kit version's";
    process.stdout.write(mine.length ? `Launcher: ${mine.map((m) => `\`${m}\``).join(", ")}${note}.\n` : "Launcher: none for this repo.\n");
  } else if (!LAUNCHER_NAME.test(name ?? "")) {
    fail("Odyssey: name the launcher with lowercase letters, digits and dashes, starting with a letter, such as `ma`.");
  } else {
    const file = launcherPath(name);
    const opens = launcherRoot(file);
    const out = [];
    if (action === "remove") {
      if (opens !== root) fail(`Launcher: ${file} ${existsSync(file) ? "isn't this repo's launcher" : "doesn't exist"}, so nothing was removed.`);
      rmSync(file);
      out.push(`Launcher: removed \`${name}\` (${file}).`);
    } else {
      if (existsSync(file) && opens !== root) fail(`Launcher: not added. ${file} already exists${opens ? `, and opens ${opens}` : ""}; pick another name.`);
      const taken = opens ? "" : onPath(name);
      if (taken) fail(`Launcher: not added. \`${name}\` is already a command here (${taken}); pick another name.`);
      if (copy !== "same") {
        mkdirSync(claudeHome(), { recursive: true });
        writeFileSync(launchFile(), readFileSync(LAUNCH_SOURCE));
      }
      mkdirSync(binDir(), { recursive: true });
      writeFileSync(file, launcherText(name, root));
      if (!WIN) chmodSync(file, 0o755);
      out.push(
        opens
          ? `Launcher: \`${name}\` was already this repo's${copy === "same" ? "" : `; replaced ${launchFile()} with this kit version's`}.`
          : `Launcher: added \`${name}\` (${file}). Run it from any folder: it opens ${root} in Claude Code, and after each /odyssey:wrap-up it starts the next session with /odyssey:handoff.`,
      );
      const dirs = (process.env.PATH ?? "").split(path.delimiter).map((d) => path.resolve(d));
      if (!dirs.includes(binDir())) out.push(WIN ? `${binDir()} isn't on your PATH: add it in your shell's startup file, then open a new terminal.` : addToPath(file));
      if (!runsBar(readSettings().settings?.statusLine)) {
        out.push("The status bar is off, so wrap-up won't start by itself at the wrap-up mark; turn the bar on with /odyssey:setup.");
      }
    }
    process.stdout.write(`${out.join("\n")}\n`);
  }
} else if (command === "next") {
  const { root, config, notice } = resolveConfig();
  const result = nextStep(root, config, { compacted: args.values.compacted, prOpen: args.values["pr-open"] });
  const said = ({ next, rule, why }) => `${next} (${rule}: ${why})`;
  const out = [`Here: ${hereLine(result.here)}.`, `Next: ${said(result.next)}`, ...result.also.map((also) => `Also: ${said(also)}`)];
  process.stdout.write(args.values.json ? `${JSON.stringify(result, null, 2)}\n` : `${notice ? `${notice}\n` : ""}${out.join("\n")}\n`);
} else if (command === "open") {
  const { root, config, notice } = resolveConfig();
  const result = openThreads(root, config);
  const out = [
    result.previous ? `Where you left off: the last handoff, ${result.previous.date} (${result.previous.file}).` : "Where you left off: no handoff has been read here yet.",
    `Last commits: ${result.recent.join("; ") || "none"}.`,
  ];
  const kinds = [...new Set(result.threads.map((t) => t.kind))];
  for (const kind of kinds) {
    const of = result.threads.filter((t) => t.kind === kind);
    out.push(`${kind} (${of.length}):`, ...of.map((t) => `  ${t.file}: ${t.text.length > 160 ? `${t.text.slice(0, 157)}...` : t.text}`));
  }
  if (kinds.length === 0) out.push("Nothing open.");
  process.stdout.write(args.values.json ? `${JSON.stringify(result, null, 2)}\n` : `${notice ? `${notice}\n` : ""}${out.join("\n")}\n`);
} else {
  fail(USAGE);
}
