// Stages a task's tree as a run would leave it after a session, from the task's reference
// patches, or with one decoy in the place of that session's reference (proofs-g.sh uses it):
//   node stage.mjs <task> <bundle> <dir> <session> [--decoy <name>]
// Clones <bundle>'s main into <dir> on the task's branch, then for each session up to <session>
// applies reference-<s>.patch and commits it, and applies reference-<s>-wip.patch uncommitted when
// there is one. For the last
// session a decoy (decoys.json) may stand in: its patch (the reference's when it has none), its
// wip flag (the reference's when unset), its message (the reference's when it has none). A
// message lands in <dir>.messages/last.txt, where check.sh's ODCK_MESSAGES finds it. Prints the
// path of the messages folder when one was written.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function stage(task, bundle, dir, session, decoyName = null) {
  const taskDir = path.join(HERE, "tasks", task);
  const steps = JSON.parse(fs.readFileSync(path.join(taskDir, "steps.json"), "utf8"));
  const decoys = fs.existsSync(path.join(taskDir, "decoys.json")) ? JSON.parse(fs.readFileSync(path.join(taskDir, "decoys.json"), "utf8")) : [];
  const decoy = decoyName ? decoys.find((d) => d.name === decoyName && d.session === session) : null;
  if (decoyName && !decoy) throw new Error(`${task} has no decoy ${decoyName} for session ${session}`);
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(`${dir}.messages`, { recursive: true, force: true });
  execFileSync("git", ["clone", "-q", "-b", "main", bundle, dir], { stdio: "ignore" });
  git("config", "user.name", "Sam Lee");
  git("config", "user.email", "sam@example.com");
  git("checkout", "-q", "-b", steps.branch);
  let messagesDir = null;
  for (let s = 1; s <= session; s++) {
    const ref = path.join(taskDir, `reference-${s}.patch`);
    const refWip = path.join(taskDir, `reference-${s}-wip.patch`);
    const refMsg = path.join(taskDir, `reference-${s}.message.txt`);
    const last = s === session && decoy;
    const patch = last && decoy.patch ? path.join(taskDir, decoy.patch) : ref;
    const wip = last && decoy.wip !== undefined ? decoy.wip : fs.existsSync(refWip);
    const message = last && decoy.message ? path.join(taskDir, decoy.message) : fs.existsSync(refMsg) ? refMsg : null;
    if (fs.existsSync(patch)) {
      git("apply", patch);
      git("add", "-A");
      git("commit", "-q", "-m", `${task}: session ${s}${last ? ` (decoy ${decoy.name})` : ""}`);
    }
    if (wip && fs.existsSync(refWip)) git("apply", refWip);
    if (s === session && message) {
      messagesDir = `${dir}.messages`;
      fs.mkdirSync(messagesDir, { recursive: true });
      fs.copyFileSync(message, path.join(messagesDir, "last.txt"));
    }
  }
  return messagesDir;
}

if (import.meta.main) {
  const [task, bundle, dir, session, flag, name] = process.argv.slice(2);
  if (!session) {
    console.error("Usage: node stage.mjs <task> <bundle> <dir> <session> [--decoy <name>]");
    process.exit(2);
  }
  const messages = stage(task, bundle, path.resolve(dir), Number(session), flag === "--decoy" ? name : null);
  if (messages) console.log(messages);
}
