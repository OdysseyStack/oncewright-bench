// What `odyssey.mjs next` (make-a-path) and `odyssey.mjs open` (what-next) read: where the repo
// stands, from its files and git only. Offline and read-only; the skills add the pull requests.
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { repoDir } from "./config.mjs";
import { HANDOFF, isWorking, slotState } from "./handoff.mjs";

export const PREVIOUS = "directives/handoff/previous.md";
const REVIEWS = "references/CR reviews";

const read = (root, file) => {
  try {
    return readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
  } catch {
    return null;
  }
};
const list = (root, dir, keep) => {
  try {
    return readdirSync(path.join(root, dir)).filter(keep).sort().map((name) => `${dir}/${name}`);
  } catch {
    return [];
  }
};
const git = (root, ...args) => {
  const run = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return run.status === 0 ? run.stdout.trim() : null;
};
const rows = (text) => (text ? text.split("\n").filter(Boolean) : []);
const date = (root, file) => statSync(path.join(root, file)).mtime.toISOString().slice(0, 10);

// The lines of `file` that match `re`, as threads of `kind`.
const matching = (root, file, re, kind) =>
  (read(root, file) ?? "").split("\n").flatMap((text, i) => (re.test(text) ? [{ kind, file: `${file}:${i + 1}`, text: text.trim() }] : []));

// The top-level list items under the first line that matches `heading`, up to `stop`: by default
// the next heading or bold label line.
function itemsUnder(text, heading, stop = /^#|^\*\*[^*]+:\*\*/) {
  const lines = (text ?? "").split("\n");
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return [];
  const items = [];
  for (const line of lines.slice(start + 1)) {
    if (stop.test(line)) break;
    if (/^(?:[-*]|\d+\.) /.test(line)) items.push(line.replace(/^(?:[-*]|\d+\.) /, "").trim());
  }
  return items;
}

// The paths `git status` lists, untracked files one by one; a rename's old path is skipped.
function changedFiles(root) {
  const run = spawnSync("git", ["status", "--porcelain", "-z", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
  const entries = run.status === 0 ? run.stdout.split("\0") : [];
  const out = [];
  for (let i = 0; i < entries.length; i++) {
    if (!entries[i]) continue;
    out.push(entries[i].slice(3));
    if (/^[RC]/.test(entries[i])) i++;
  }
  return out;
}

function gitState(root) {
  const head = git(root, "symbolic-ref", "--short", "refs/remotes/origin/HEAD");
  const base = head ? head.replace(/^origin\//, "") : ["main", "master"].find((name) => git(root, "rev-parse", "--verify", "-q", `refs/heads/${name}`));
  const branch = git(root, "branch", "--show-current") || null;
  const upstream = git(root, "rev-parse", "--abbrev-ref", "@{u}");
  const remotes = rows(git(root, "remote"));
  return {
    branch,
    base: base ?? null,
    changed: changedFiles(root).filter((file) => !isWorking(file)),
    upstream,
    ahead: upstream ? Number(git(root, "rev-list", "--count", "@{u}..HEAD")) : null,
    pastBase: base && branch && branch !== base ? Number(git(root, "rev-list", "--count", `${base}..HEAD`) ?? 0) : 0,
    unpushed: remotes.length ? rows(git(root, "log", "--branches", "--not", "--remotes", "--format=%h %s")) : null,
    unmerged: base ? rows(git(root, "branch", "--no-merged", base, "--format=%(refname:short)")) : [],
    recent: rows(git(root, "log", "-3", "--format=%cs %h %s")),
  };
}

// -> everything both commands read.
export function readState(root, config = {}) {
  const reviews = list(root, REVIEWS, (name) => /\.(md|resolved)$/.test(name));
  const resolved = reviews.filter((file) => file.includes(".resolved"));
  const findings = reviews.filter((file) => !file.includes(".resolved"));
  const source = (file) => file.replace(".resolved", "");
  const plans = [...new Set([...list(root, "docs/plans", (name) => name.endsWith(".md")).reverse(), ...[config.docs?.plan].filter(Boolean).map(repoDir)])].flatMap((file) => {
    const text = read(root, file);
    if (text === null) return [];
    const status = /\*\*Status:\*\*\s*([A-Z]+)/.exec(text.split("\n").slice(0, 5).join("\n"))?.[1] ?? null;
    return [{ file, status, grilled: /^Grilling done /m.test(text) }];
  });
  const grills = list(root, "docs/grills", (name) => name.endsWith(".md")).map((file) => ({ file, done: /^Grilling done /m.test(read(root, file)) }));
  return {
    setup: Boolean(read(root, ".claude/odyssey.json") !== null || list(root, ".claude/rules/odyssey", () => true).length),
    handoff: slotState(path.join(root, HANDOFF)),
    git: gitState(root),
    untriaged: findings.filter((file) => !resolved.some((r) => source(r) === file)),
    resolved,
    plans,
    grills,
  };
}

// make-a-path's rules, first match wins. -> { here, next, also }, `also` the next two matches.
export function nextStep(root, config = {}, { compacted = false, prOpen = false } = {}) {
  const s = readState(root, config);
  const fired = [];
  const rule = (name, next, why) => fired.push({ rule: name, next, why });
  if (!s.setup) rule("setup missing", "/odyssey:setup", "the repo has no .claude/odyssey.json and no kit rules");
  if (s.handoff === "held") rule("handoff waiting", "/odyssey:handoff", `a message is waiting in ${HANDOFF}`);
  if (compacted) rule("compacted session", "/odyssey:handoff write", "this session was compacted, so leave the next one its opening message");
  for (const file of s.untriaged) rule("findings untriaged", `/odyssey:cr-triage ${file}`, "a CodeRabbit findings file has no .resolved beside it");
  const g = s.git;
  if (g.pastBase > 0 && (g.upstream === null || g.ahead > 0) && !prOpen)
    rule("commits ahead, no PR", "the pre-push CodeRabbit CLI review, then push and open a PR", `${g.branch} has ${g.pastBase} commit${g.pastBase === 1 ? "" : "s"} past ${g.base}, not pushed or with no PR`);
  for (const p of s.plans.filter((plan) => plan.status === "ACTIVE")) {
    if (p.grilled) rule("plan grilled", `the next slice of ${p.file}`, "make it directly, naming its files first; when every slice has landed, set its status header to CLOSED <sha>");
    else rule("plan not grilled", `/odyssey:grill-me ${p.file}`, "the plan is ACTIVE with no Grilling done line");
  }
  for (const r of s.grills.filter((grill) => !grill.done)) rule("plan not grilled", `/odyssey:grill-me ${r.file}`, "the grilling record has no Grilling done line, so it resumes");
  if (fired.length === 0) rule("nothing open", "wait", "no handoff, findings file, unpushed branch or active plan");
  return { here: s, next: fired[0], also: fired.slice(1, 3) };
}

export function hereLine(s) {
  const g = s.git;
  const parts = [g.branch ? `on ${g.branch}` : "no branch checked out"];
  parts.push(g.changed.length ? `${g.changed.length} changed file${g.changed.length === 1 ? "" : "s"}` : "a clean tree");
  if (g.upstream === null && g.pastBase > 0) parts.push(`${g.pastBase} commit${g.pastBase === 1 ? "" : "s"} past ${g.base}, no upstream`);
  else if (g.ahead) parts.push(`${g.ahead} commit${g.ahead === 1 ? "" : "s"} not pushed`);
  if (s.handoff === "held") parts.push("a handoff waiting");
  return parts.join(", ");
}

// what-next's sources: every open thread, each with the file it came from.
export function openThreads(root, config = {}) {
  const s = readState(root, config);
  const g = s.git;
  const threads = [];
  const add = (kind, file, text) => threads.push({ kind, file, text });
  for (const file of g.changed) add("uncommitted", file, "changed, not committed");
  for (const line of g.unpushed ?? []) add("unpushed", "git", line);
  for (const name of g.unmerged) add("unmerged branch", "git", `${name}, not merged into ${g.base}`);
  for (const p of s.plans.filter((plan) => plan.status === "ACTIVE")) add("active plan", p.file, p.grilled ? "ACTIVE, grilled" : "ACTIVE, not grilled");
  for (const file of [...s.plans.map((p) => p.file), ...s.grills.map((r) => r.file)]) threads.push(...matching(root, file, /^G\d+ — .*: OPEN\b/, "open grilling question"));
  for (const file of s.resolved) threads.push(...matching(root, file, /\bdefer/i, "deferred CR finding"));
  for (const item of itemsUnder(read(root, "CHANGELOG.md"), /^## \[?Unreleased\]?/i, /^## /)) add("unreleased", "CHANGELOG.md", item);
  const previous = read(root, PREVIOUS);
  // Flags written on the label's own line, not as a list under it, are one item.
  const inline = /^\*\*Open flags:?\*\*:? *(\S.*)$/im.exec(previous ?? "")?.[1];
  for (const item of [inline, ...itemsUnder(previous, /^(?:#+ *)?\*\*Open flags:?\*\*|^#+ *Open flags/i)].filter(Boolean)) add("last handoff's open flag", PREVIOUS, item);
  return { previous: previous === null ? null : { file: PREVIOUS, date: date(root, PREVIOUS) }, recent: g.recent, threads };
}
