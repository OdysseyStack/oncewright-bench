// A stand-in for claude, for proofs-g.sh (no model call): logs each -p call's arguments and prompt
// under CLAUDE_CONFIG_DIR, acts on the clone the way a script says, and prints the JSON the real CLI
// prints, with total_cost_usd as the session's running total (STUB_STEP a turn, $0.50 by default).
//   claude auth status                     -> logged in
//   claude -p <prompt> ... --session-id|--resume <uuid> [--plugin-dir <dir>]
// STUB_SCRIPT names a JSON file: { "<k>": action } for the k-th -p call in this home (1-based), and
// "default" for the rest. An action: { "reply": text, "apply": patch, "wip": patch, "commit": branch,
// "touch": file, "clean": true, "handoff": text }: apply a patch and commit it on the branch (made
// from HEAD when missing), apply a patch uncommitted, touch a file (a dirty tree), clean the tree,
// write the kit's handoff slot; "handoffRead": true moves the slot's message to previous.md and resets
// the slot, as /odyssey:handoff does. The reply is the JSON's result.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const home = process.env.CLAUDE_CONFIG_DIR;
if (args[0] === "auth" && args[1] === "status") {
  console.log('{ "loggedIn": true }');
  process.exit(0);
}
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const p = args.indexOf("-p");
let prompt = p >= 0 && args[p + 1] !== undefined && !args[p + 1].startsWith("--") ? args[p + 1] : null;
if (prompt === null) prompt = fs.readFileSync(0, "utf8");
// One line a call: a prompt's newlines are shown as ⏎, so line numbers hold; env.log gets the call's HOME.
fs.appendFileSync(path.join(home, "calls.log"), `${args.join(" ").replace(/\n/g, "⏎")}\n`);
fs.appendFileSync(path.join(home, "env.log"), `${process.env.HOME}\n`);
// The instructions from outside the repo the call could load: user-level (~/.claude/CLAUDE.md under its HOME,
// CLAUDE.md in its config dir), and project-level from every folder above its working folder, as Claude Code does.
const memory = [path.join(process.env.HOME, ".claude", "CLAUDE.md"), path.join(home, "CLAUDE.md")].filter((f) => fs.existsSync(f));
for (let d = path.dirname(process.cwd()); ; d = path.dirname(d)) {
  for (const f of ["CLAUDE.md", "CLAUDE.local.md", ".claude/CLAUDE.md", ".claude/rules"]) if (fs.existsSync(path.join(d, f))) memory.push(path.join(d, f));
  if (path.dirname(d) === d) break;
}
fs.appendFileSync(path.join(home, "memory.log"), `${memory.join(" ") || "none"}\n`);
const k = fs.readdirSync(home).filter((f) => f.startsWith("prompt-")).length + 1;
fs.writeFileSync(path.join(home, `prompt-${k}.txt`), prompt);
const uuid = flag("--session-id") ?? flag("--resume");
const inSession = fs.readFileSync(path.join(home, "calls.log"), "utf8").split("\n").filter((l) => l.includes(uuid)).length;
const step = Number(process.env.STUB_STEP ?? 0.5);
const script = process.env.STUB_SCRIPT ? JSON.parse(fs.readFileSync(process.env.STUB_SCRIPT, "utf8")) : {};
const action = script[String(k)] ?? script.default ?? {};
const git = (...a) => execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
if (action.clean) {
  git("checkout", "--", ".");
  git("clean", "-fdq");
}
if (action.apply) git("apply", action.apply);
if (action.touch) fs.appendFileSync(action.touch, "\n// touched by the stand-in\n");
if (action.commit) {
  try {
    git("rev-parse", "--verify", `refs/heads/${action.commit}`);
    git("checkout", "-q", action.commit);
  } catch {
    git("checkout", "-q", "-b", action.commit);
  }
  git("add", "-A");
  git("commit", "-q", "--allow-empty", "-m", action.message ?? `stand-in: call ${k}`);
}
if (action.wip) git("apply", action.wip);
if (action.handoff) {
  fs.mkdirSync("directives/handoff", { recursive: true });
  fs.writeFileSync("directives/handoff/current.md", action.handoff);
}
if (action.handoffRead) {
  // As /odyssey:handoff does: the message to previous.md, the slot reset to its placeholder.
  fs.copyFileSync("directives/handoff/current.md", "directives/handoff/previous.md");
  fs.writeFileSync("directives/handoff/current.md", "<!-- Empty: the closing session writes the next session's opening message here with /odyssey:handoff write; /odyssey:handoff reads it and resets this file. -->\n");
}
const reply = action.reply ?? `Stand-in reply to call ${k}.`;
console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 1, result: reply, session_id: uuid, total_cost_usd: Number((step * inSession).toFixed(4)), permission_denials: [] }));
