// Config resolution, shared by the hooks and scripts/odyssey.mjs.
//
// One .claude/odyssey.json applies per session. The search starts at CLAUDE_PROJECT_DIR
// when Claude Code sets it (for hooks: the directory the session started in, which does
// not follow a `cd`), else at the process's cwd (the script, run from the project). It
// walks up to the git root, and the first .claude/odyssey.json it meets wins; outside a
// git repo only the start directory counts. The start is read as the file system spells
// it, so a path typed in another letter case names the same root. The file is checked
// against the bundled schema. Missing means defaults. Invalid means defaults plus one
// notice, so a bad file switches the opt-in hooks off instead of locking the session.
// Two hooks look past the session's checkout to a linked git worktree of the same repo:
// post-edit, for a file it edits there, and typecheck-gate, for a cwd that has moved into
// one (configFor, below).
import { createHash } from "node:crypto";
import { closeSync, existsSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const SCHEMA = JSON.parse(readFileSync(new URL("../schema/odyssey.v1.json", import.meta.url), "utf8"));

// -> { root, file, config, notice }. `root` is the real path of the directory holding
// .claude/ (with no config: the git root). `config` is {} when the file is missing or invalid.
export function resolveConfig(start = process.env.CLAUDE_PROJECT_DIR || process.cwd()) {
  const dirs = [];
  for (let dir = realpathSync.native(start); ; dir = path.dirname(dir)) {
    dirs.push(dir);
    if (existsSync(path.join(dir, ".git"))) break;
    if (path.dirname(dir) === dir) {
      dirs.length = 1; // no git repo above the start: only the start directory counts
      break;
    }
  }
  for (const dir of dirs) {
    const file = path.join(dir, ".claude", "odyssey.json");
    if (existsSync(file)) return load(file, dir);
  }
  return { root: dirs.at(-1), file: null, config: {}, notice: null };
}

function load(file, root) {
  let config;
  let problem;
  try {
    config = JSON.parse(readFileSync(file, "utf8"));
    problem = check(SCHEMA, config, "");
  } catch (err) {
    problem = err.message;
  }
  if (!problem) return { root, file, config, notice: null };
  return {
    root,
    file,
    config: {},
    notice: `Odyssey: ${file} is invalid (${problem}), so until it is fixed its opt-in hooks are off and the secrets guard uses only its defaults.`,
  };
}

// The top of the git checkout holding `dir`: the nearest folder up that has a .git entry, a
// folder in a repo's own checkout and a file in a linked worktree. -> a path, or null.
export function checkoutTop(dir) {
  for (let top = dir; ; top = path.dirname(top)) {
    if (existsSync(path.join(top, ".git"))) return top;
    if (path.dirname(top) === top) return null;
  }
}

// Git's common folder for the checkout at `top`, the .git folder every worktree of one repo
// shares: the checkout's own .git folder, or for a linked worktree the one its .git file
// names, but only when git's record of that worktree points back at this checkout. A .git
// file that names another repo without that link, as a downloaded folder could, counts as no
// repo, and so does a .git that is a symbolic link, which belongs to the checkout it points
// into, not this one. -> a real path, or null.
export function commonDir(top) {
  try {
    const git = path.join(top, ".git");
    const entry = lstatSync(git);
    if (entry.isSymbolicLink()) return null;
    if (entry.isDirectory()) return realpathSync.native(git);
    const gitdir = path.resolve(top, /^gitdir:(.*)$/m.exec(readFileSync(git, "utf8"))[1].trim());
    const back = path.resolve(gitdir, readFileSync(path.join(gitdir, "gitdir"), "utf8").trim());
    if (realpathSync.native(back) !== realpathSync.native(git)) return null;
    return realpathSync.native(path.resolve(gitdir, readFileSync(path.join(gitdir, "commondir"), "utf8").trim()));
  } catch {
    return null;
  }
}

// The config for a hook that acts in `dir` (the edited file's folder, or the folder a Stop hook
// reports as the session's cwd): when `dir` is in another checkout of the session's repo, a
// linked git worktree or the repo's own checkout seen from one, the config that checkout gives,
// found from the folder matching the session's start (from its top when that folder is missing,
// or when a link or a nested repo leads out of it); else `resolved`, the session's own.
// A folder that can't be read leaves the session's config in charge.
export function configFor(dir, resolved, start = process.env.CLAUDE_PROJECT_DIR || process.cwd()) {
  if (typeof dir !== "string" || !resolved.root) return resolved;
  try {
    const mine = checkoutTop(resolved.root);
    const theirs = checkoutTop(realpathSync.native(dir));
    if (!mine || !theirs || theirs === mine) return resolved;
    const common = commonDir(mine);
    if (!common || commonDir(theirs) !== common) return resolved;
    const same = path.join(theirs, path.relative(mine, realpathSync.native(start)));
    return resolveConfig(existsSync(same) && checkoutTop(realpathSync.native(same)) === theirs ? same : theirs);
  } catch {
    return resolved;
  }
}

// The subset of JSON Schema that schema/odyssey.v1.json uses. -> the first problem, or "".
// The schema uses `pattern` only to keep file names free of path separators.
// scripts/odyssey.mjs checks the interview's answers with it too.
export function check(schema, value, at) {
  const where = at || "the top level";
  const type = Array.isArray(value)
    ? "array"
    : value === null
      ? "null"
      : Number.isInteger(value)
        ? "integer"
        : typeof value;
  if (schema.type && schema.type !== type) return `${where}: expected ${schema.type}`;
  if ("const" in schema && value !== schema.const) {
    return `${where}: expected ${JSON.stringify(schema.const)}`;
  }
  if (type === "string" && value.length < (schema.minLength ?? 0)) return `${where}: empty`;
  if (type === "string" && schema.pattern && !new RegExp(schema.pattern, "u").test(value)) {
    return `${where}: expected a file name, not a path`;
  }
  if (type === "integer" && (value < schema.minimum || value > schema.maximum)) {
    return `${where}: expected ${schema.minimum} to ${schema.maximum}`;
  }
  if (type === "array") {
    for (const [i, item] of value.entries()) {
      const problem = check(schema.items ?? {}, item, `${at}[${i}]`);
      if (problem) return problem;
    }
  }
  if (type === "object") {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) return `${where}: missing "${key}"`;
    }
    for (const [key, item] of Object.entries(value)) {
      const sub = Object.hasOwn(schema.properties ?? {}, key)
        ? schema.properties[key]
        : (schema.additionalProperties ?? {});
      if (sub === false) return `${where}: unknown key "${key}"`;
      const problem = check(sub, item, at ? `${at}.${key}` : key);
      if (problem) return problem;
    }
  }
  return "";
}

// A srcDirs or testDirs entry as the hooks match it: a path from the repo root, with a leading
// "./" and a trailing "/" dropped, so "src", "./src" and "src/" all mean src/.
export const repoDir = (entry) => entry.replace(/^\.(\/|$)/, "").replace(/\/+$/, "");

// For hooks: the tool-call payload on stdin plus the session's config. An invalid config
// reads as {}, which leaves every opt-in hook off, and its notice shows once per session.
// So does a start folder that can't be read, such as a worktree removed mid-session: the
// secrets guard then keeps its defaults instead of blocking every call. A NotebookEdit
// call names its file in `notebook_path`, which is read here as `file_path`, the field
// every guard checks.
export function hookInput() {
  const payload = JSON.parse(readFileSync(0, "utf8"));
  const input = payload?.tool_input;
  if (typeof input?.notebook_path === "string") input.file_path ??= input.notebook_path;
  let resolved;
  try {
    resolved = resolveConfig();
  } catch (err) {
    const start = process.env.CLAUDE_PROJECT_DIR || "the folder this session started in";
    resolved = {
      root: null,
      file: null,
      config: {},
      notice: `Odyssey: ${start} can't be read (${err.code ?? err.message}), so its opt-in hooks are off and the secrets guard uses only its defaults.`,
    };
  }
  if (resolved.notice) noticeOnce(payload, resolved.notice);
  return { payload, ...resolved };
}

// A warning shown to the user, not to Claude: JSON `systemMessage` on stdout, exit 0.
export function notice(text) {
  process.stdout.write(`${JSON.stringify({ systemMessage: text })}\n`);
}

// notice(), once per session and text. Matching hooks run in parallel, so the first one
// to create the marker file speaks and the rest stay quiet.
export function noticeOnce(payload, text) {
  const key = createHash("sha256").update(`${payload?.session_id}\n${text}`).digest("hex");
  try {
    closeSync(openSync(path.join(os.tmpdir(), `odyssey-notice-${key.slice(0, 16)}`), "wx"));
  } catch (err) {
    if (err.code === "EEXIST") return; // already shown this session
  }
  notice(text);
}
