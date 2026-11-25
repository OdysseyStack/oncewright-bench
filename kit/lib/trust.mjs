// Trust for the hooks that run code, shared by the hooks and scripts/odyssey.mjs.
//
// Repo config can switch a hook on, but never make the plugin run a command the user has
// not approved. The user approves by running `odyssey.mjs trust approve` themselves.
// Records live in ~/.claude/odyssey-trust.json, keyed by the repo root's real path (for a
// root in a linked git worktree, the same folder in the repo's own checkout: trustKey) and
// the exact command string, so a repo and its worktrees share their approvals, a repo at a
// new path asks again, and a changed command stops until it is approved again. The file
// is the only source of trust: no environment variable grants it, since a repo's own
// settings file can set one for every hook. A CI pipeline runs `odyssey.mjs trust approve`
// as one of its own steps.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkoutTop, commonDir } from "./config.mjs";

// post-edit's formatter runs the repo's own Prettier and ESLint, so its fixed key names
// their entry files.
export const FORMATTER =
  "post-edit formatter: node_modules/prettier/bin/prettier.cjs and node_modules/eslint/bin/eslint.js";

// Where the formatter finds those entry files: the nearest node_modules that holds one, from
// the folder `from` up to the git root, as Node resolves a package, so a workspace that installs
// Prettier once at its root is formatted too. It looks no higher than the git root (outside a git
// repo, no higher than `root`), so nothing installed above the repo ever runs.
// -> the entry file's path, or null.
export function localBin(root, from, pkg, file) {
  let top = root;
  while (!existsSync(path.join(top, ".git")) && path.dirname(top) !== top) top = path.dirname(top);
  if (!existsSync(path.join(top, ".git"))) top = root;
  for (let dir = from; ; dir = path.dirname(dir)) {
    const bin = path.join(dir, "node_modules", pkg, file);
    if (existsSync(bin)) return bin;
    if (dir === top || path.dirname(dir) === dir) return null;
  }
}

const SCRIPT = fileURLToPath(new URL("../scripts/odyssey.mjs", import.meta.url));

export const trustFile = () => path.join(os.homedir(), ".claude", "odyssey-trust.json");

// A record names a repo and a command. Anything else in the list is skipped, so one bad
// entry never stops a hook.
const isRecord = (record) => typeof record?.repo === "string" && typeof record?.command === "string";

// -> the records; [] when there is no trust file yet. Throws, saying what to do, when the
// file is there and does not read as a list of records.
export function loadTrust() {
  let text;
  try {
    text = readFileSync(trustFile(), "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  let records;
  try {
    records = JSON.parse(text)?.trusted;
  } catch {
    records = null; // not JSON
  }
  if (!Array.isArray(records)) throw new Error(`${trustFile()} does not read as trust records. Fix or delete it.`);
  return records.filter(isRecord);
}

// For the hooks: a trust file that can't be read trusts nothing.
export function readTrust() {
  try {
    return loadTrust();
  } catch {
    return [];
  }
}

// Reads the records, changes them and writes them back as one step. A lock file makes a
// second run wait, for up to five seconds, so two approvals at the same moment both land.
// The write arrives by rename, from a file only the user can read, so a reader never meets
// half a file. Throws on a trust file it can't read, and leaves that file as it is.
// ponytail: a lock is never taken over, since telling a dead run's lock from a live one's
// is a race of its own. A run that dies holding it leaves the file, and the next run says
// to delete it. Take stale locks over only if approvals ever run unattended in bulk.
export function updateTrust(change) {
  mkdirSync(path.dirname(trustFile()), { recursive: true });
  const lock = `${trustFile()}.lock`;
  for (let tries = 0; ; tries++) {
    try {
      writeFileSync(lock, String(process.pid), { flag: "wx" });
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      if (tries >= 100) throw new Error(`Another trust update holds ${lock}. If none is running, delete that file.`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); // 50 ms
    }
  }
  const next = `${trustFile()}.${process.pid}.tmp`;
  try {
    const text = `${JSON.stringify({ trusted: change(loadTrust()) }, null, 2)}\n`;
    writeFileSync(next, text, { flag: "wx", mode: 0o600 });
    renameSync(next, trustFile());
  } finally {
    rmSync(next, { force: true });
    rmSync(lock, { force: true });
  }
}

// The folder a record names for `root`: `root` itself, or for a root inside a linked git
// worktree, the same folder in the checkout the repo's .git folder sits in (in a bare repo, under
// that folder), so a repo and its worktrees share one set of approvals.
export function trustKey(root) {
  const top = checkoutTop(root);
  const common = top && commonDir(top);
  if (!common) return root;
  const home = path.basename(common) === ".git" ? path.dirname(common) : common;
  return path.join(home, path.relative(top, root));
}

export function isTrusted(root, command) {
  const key = trustKey(root);
  return readTrust().some((record) => record.repo === key && record.command === command);
}

// The commands the commit gate runs (hooks/bash-guard.mjs): each gate stage's, then the repo's
// docs check. [] when the config names no stages or `hooks.commitGate` is false.
export function gateCommands(config) {
  const stages = config.gate?.stages ?? [];
  if (config.hooks?.commitGate === false || stages.length === 0) return [];
  return [...stages.map((stage) => stage.command), ...(config.docs?.check ? [config.docs.check] : [])];
}

// The commands the config switches on that run code: what `trust approve` records.
export function configuredCommands(config) {
  const commands = [];
  if (config.hooks?.formatOnEdit === true) commands.push(FORMATTER);
  const gate = config.hooks?.typecheckGate;
  if (gate?.enabled === true && gate.command) commands.push(gate.command);
  return [...new Set([...commands, ...gateCommands(config)])];
}

// The notice a hook shows when it skipped an untrusted command.
export function untrusted(what, root) {
  return (
    `Odyssey: ${what} did not run, because you have not trusted it in ${root}. ` +
    `To trust it, run this yourself in that repo: node "${SCRIPT}" trust approve`
  );
}
