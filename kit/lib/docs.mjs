// The docs check (`scripts/odyssey.mjs docs check`), the gate's docs stage (local-gate's gate.md).
// It re-reads the claims the repo's instruction files make against the repo as it stands, so
// a claim that was wrong when written, or that sits on lines no diff touches, is caught on
// the next pass.
//
// It first lists the instruction files, found by walking the repo, not through git, so a
// git-ignored CLAUDE.local.md is on the list: CLAUDE.md, .claude/CLAUDE.md and CLAUDE.local.md
// in any folder, .claude/rules/**, the fallback pair AGENTS names below, and every file one of
// them imports with `@`. Each comes with when Claude Code loads it, by the rules its memory
// docs give, which `claude --init-only` runs confirmed on 2026-09-27. Then the files outside
// the repo that Claude Code loads beside them: yours under ~/.claude, the managed one, and those
// in the folders above the repo, listed and never edited. With
// hooks.loadLog on, hooks/load-log.mjs logs every load, and the check counts the logged
// sessions that loaded each file.
//
// Six checks, one report group each:
//   imports    every `@` import names a file
//   paths      every repo path a doc names in backticks, or as a link target, exists
//   scripts    every `npm run <name>` names a package.json script (repos that have one)
//   adrs       every ADR a doc cites (`ADR 0007`, `docs/adr/0007`) exists in docs/adr/
//   shadowing  no skill or agent under ~/.claude has the name of one of the repo's own:
//              a personal skill loads instead of a project skill of the same name
//   unreadable every file it opens can be read; one that can't, such as a link whose target
//              is gone, is named with the reason, and the rest of the check goes on
//
// The files it reads for claims: each Markdown file on the list inside the repo, CONTEXT.md,
// GLOSSARY.md, README.md, .claude/agents/*.md and .claude/skills/*/SKILL.md. A kit-owned rule
// (stamped `odyssey-managed`) describes the kit, not the repo, so its claims are left out, and so
// is history: docs/plans, docs/adr and CHANGELOG.md. It opens only Markdown files; every other
// file is checked for existence by name only and never opened, so no secret file is read.
//
// An error fails the check; a warning does not. A named path that is missing but git-ignored
// is a warning, since a build may create it (dist/); when git can't say, the error says so.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { STAMP } from "./stamp.mjs";

// The files Claude Code reads as instructions in each folder.
const CLAUDE_FILES = ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"];
const AGENTS = ["AGENTS.md", ".claude/AGENTS.md"]; // Claude Code reads these only where no CLAUDE_FILES stand in the folder or above it
const MANAGED =
  { darwin: "/Library/Application Support/ClaudeCode/CLAUDE.md", win32: "C:\\Program Files\\ClaudeCode\\CLAUDE.md" }[process.platform] ??
  "/etc/claude-code/CLAUDE.md";
const HOPS = 4; // how deep Claude Code follows a chain of imports
const DOCS = ["CONTEXT.md", "GLOSSARY.md", "README.md"]; // read for claims beside the instruction files
const AT_START = "loads at start";
const NEVER_FALLBACK = "never loads: Claude Code reads it only where no `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` stands in its folder or above it";
// Tokens ending in one of these read as file names even without a slash (`cart.js`).
const FILE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "jsonl", "md", "yaml", "yml", "toml", "sql",
  "sh", "py", "go", "rs", "rb", "java", "txt", "html", "css", "lock",
]);
// Where a bare file name may live, beside the config's srcDirs and testDirs.
const BASENAME_ROOTS = ["src", "test", "tests", "scripts", "docs", "directives", ".claude", ".github"];
// Folders that hold other projects' files or build output, a CLAUDE.md among them at times.
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", ".venv", "venv", "vendor", "target"]);

// The load log hooks/load-log.mjs keeps for a repo, one file per repo root, and the size past
// which it starts over.
export const loadLogFile = (root, home) =>
  path.join(home, ".claude", "odyssey-loads", `${createHash("sha256").update(root).digest("hex").slice(0, 16)}.jsonl`);
export const LOAD_LOG_CAP = 256 * 1024;

const lexists = (file) => {
  try {
    lstatSync(file);
    return true;
  } catch {
    return false;
  }
};

const isFile = (file) => {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
};

// Real files and directories under `dir`, links left out, in name order. -> [{ name, dir }]
function entries(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => !e.isSymbolicLink() && (e.isFile() || e.isDirectory()))
      .map((e) => ({ name: e.name, dir: e.isDirectory() }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch {
    return [];
  }
}

const join = (rel, name) => (rel === "." ? name : `${rel}/${name}`);
const relative = (root, file) => path.relative(root, file).split(path.sep).join("/");
const shown = (file, home) => (file.startsWith(home + path.sep) ? `~/${relative(home, file)}` : file);
// A reader for one check: each file's text, or null when it can't be read, read once. Each file
// that can't be read becomes one error in `unreadable`.
function reader(unreadable) {
  const texts = new Map();
  return (abs, file) => {
    if (!texts.has(abs)) {
      try {
        texts.set(abs, readFileSync(abs, "utf8"));
      } catch (err) {
        texts.set(abs, null);
        unreadable.push({ severity: "error", where: file, message: `can't be read (${err.code ?? err.message}): Claude Code can't load it, and nothing in it is checked` });
      }
    }
    return texts.get(abs);
  };
}
const UNREADABLE = "never loads: it can't be read";

const isKitRule = (text) => {
  const cut = text.indexOf("\n");
  return STAMP.test(cut < 0 ? text : text.slice(0, cut));
};

// The .md files under `dir`, recursively, as paths relative to `root`.
function markdownUnder(root, rel) {
  return entries(path.join(root, rel)).flatMap((e) => {
    const child = `${rel}/${e.name}`;
    if (e.dir) return markdownUnder(root, child);
    return e.name.endsWith(".md") ? [child] : [];
  });
}

// Every folder of the repo, the root first as ".", with vendor and build folders left out.
// A .claude folder is read by name, not walked.
function folders(root, rel = ".") {
  return [
    rel,
    ...entries(path.join(root, rel))
      .filter((e) => e.dir && !SKIP_DIRS.has(e.name) && e.name !== ".claude")
      .flatMap((e) => folders(root, join(rel, e.name))),
  ];
}

// A rule's `paths` frontmatter as written, or "" when it names none: such a rule loads at start.
export function rulePaths(text) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!front) return "";
  const lines = front[1].split(/\r?\n/);
  const at = lines.findIndex((line) => /^paths\s*:/.test(line));
  if (at < 0) return "";
  const inline = lines[at].replace(/^paths\s*:/, "").trim();
  const items = inline.startsWith("[") ? inline.replace(/^\[|\]$/g, "").split(",") : inline ? [inline] : [];
  for (const line of lines.slice(at + 1)) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (!item) break;
    items.push(item[1]);
  }
  return items
    .map((item) => item.trim().replace(/^(["'])(.*)\1$/, "$2"))
    .filter(Boolean)
    .join(", ");
}

// The `@` imports in an instruction file, as Claude Code reads them (measured 2026-09-27 with
// `claude --init-only`): an `@` at the start of a line or after a space, the rest of the word
// taken as written (`@docs/a.md.` names "docs/a.md."), emphasis around it aside (`**@a.md**`);
// never inside fenced or indented code, a code span or an HTML comment. Indented code is text
// indented four columns past its list item's content, or past the margin outside a list, that
// no paragraph line runs into. -> [{ target, line }]
export function importTokens(lines) {
  const out = [];
  const width = (lead) => lead.replace(/\t/g, "    ").length;
  let fenced = false;
  let code = false;
  let comment = false;
  let text = false; // the line before was paragraph text, which the next line may continue
  let list = null; // the content column of the list item the lines belong to
  lines.forEach((raw, i) => {
    if (/^\s*(```|~~~)/.test(raw)) {
      fenced = !fenced;
      text = false;
      return;
    }
    if (fenced) return;
    if (raw.trim() === "") {
      text = false;
      return;
    }
    const lead = width(/^[ \t]*/.exec(raw)[0]);
    const item = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/.exec(raw);
    if (item) list = width(item[0]);
    else if (list !== null && lead < list && !text) list = null;
    code = !item && lead >= (list ?? 0) + 4 && (code || !text);
    if (code) return;
    let kept = "";
    for (let rest = raw; rest; ) {
      if (comment) {
        const end = rest.indexOf("-->");
        if (end < 0) break;
        comment = false;
        rest = rest.slice(end + 3);
      } else {
        const start = rest.indexOf("<!--");
        if (start < 0) {
          kept += rest;
          break;
        }
        kept += `${rest.slice(0, start)} `;
        comment = true;
        rest = rest.slice(start + 4);
      }
    }
    // A heading or a line that was all comment is a block of its own, not paragraph text.
    text = kept.trim() !== "" && !/^ {0,3}#{1,6}(\s|$)/.test(kept);
    kept = kept.replace(/(`+)[\s\S]*?\1/g, " ");
    for (const m of kept.matchAll(/(?:^|\s)([*_]*)@(\S+)/g)) {
      out.push({ target: m[1] ? m[2].replace(/[*_]+$/, "") : m[2], line: i + 1 });
    }
  });
  return out;
}

// Where each instruction file sits and when Claude Code loads it, for a session started at the
// repo root. -> { inRepo, outside, findings }: the entries are { file, abs, loads, when }, plus
// `kit` for a kit rule and `fallback` for a fallback file that loads; the findings are the
// imports check's. `read` is the check's reader.
function walk(root, home, read) {
  const inRepo = [];
  const outside = [];
  const findings = [];
  const seen = new Set();
  const add = (list, entry) => {
    if (seen.has(entry.abs)) return false;
    seen.add(entry.abs);
    list.push({ when: entry.loads, ...entry });
    return true;
  };
  const has = (dir, names) => names.some((name) => lexists(path.join(dir, name)));
  const above = [];
  for (let dir = root; path.dirname(dir) !== dir; ) above.push((dir = path.dirname(dir)));
  // ~/.claude/CLAUDE.md is yours, not a project file, so it never keeps the fallback pair out.
  const claudeFiles = (dir) => CLAUDE_FILES.filter((name) => dir !== home || name !== ".claude/CLAUDE.md");
  const fallback = !has(root, CLAUDE_FILES) && !above.some((dir) => has(dir, claudeFiles(dir)));

  for (const rel of folders(root)) {
    const dir = path.join(root, rel);
    const loads = rel === "." ? AT_START : `loads when Claude reads a file under ${rel}/`;
    for (const name of CLAUDE_FILES) {
      const file = join(rel, name);
      if (lexists(path.join(dir, name))) add(inRepo, { file, abs: path.join(dir, name), loads: read(path.join(dir, name), file) === null ? UNREADABLE : loads });
    }
    for (const name of AGENTS) {
      if (!lexists(path.join(dir, name))) continue;
      const file = join(rel, name);
      const readByClaude = fallback && (rel === "." || !has(dir, CLAUDE_FILES));
      const loadsHere = read(path.join(dir, name), file) === null ? UNREADABLE : readByClaude ? loads : NEVER_FALLBACK;
      add(inRepo, { file, abs: path.join(dir, name), loads: loadsHere, fallback: readByClaude && loadsHere === loads });
    }
    for (const rule of markdownUnder(root, join(rel, ".claude/rules"))) {
      const text = read(path.join(root, rule), rule);
      const globs = text === null ? "" : rulePaths(text);
      const whenRead = globs ? `loads when Claude reads a file matching ${globs}` : loads;
      add(inRepo, { file: rule, abs: path.join(root, rule), loads: text === null ? UNREADABLE : whenRead, kit: text !== null && isKitRule(text) });
    }
  }

  const beside = (abs, loads) => lexists(abs) && add(outside, { file: shown(abs, home), abs, loads });
  beside(path.join(home, ".claude", "CLAUDE.md"), AT_START);
  for (const rule of markdownUnder(home, ".claude/rules")) {
    const text = read(path.join(home, rule), `~/${rule}`);
    const globs = text === null ? "" : rulePaths(text);
    beside(path.join(home, rule), text === null ? UNREADABLE : globs ? `loads when Claude reads a file matching ${globs}` : AT_START);
  }
  beside(MANAGED, AT_START);
  for (const dir of above) {
    for (const name of claudeFiles(dir)) beside(path.join(dir, name), AT_START);
    for (const name of AGENTS) beside(path.join(dir, name), fallback ? AT_START : NEVER_FALLBACK);
  }

  // Imports, breadth first from each Markdown file in the repo, so each file is listed at the
  // shortest chain that reaches it. Files outside the repo are listed, not followed.
  const queue = inRepo.filter((e) => e.abs.endsWith(".md")).map((entry) => ({ entry, depth: 0 }));
  for (let i = 0; i < queue.length; i++) {
    const { entry: from, depth } = queue[i];
    const text = read(from.abs, from.file);
    if (depth > HOPS || text === null) continue;
    for (const { target, line } of importTokens(text.split("\n"))) {
      const where = `${from.file}:${line}`;
      const abs = target.startsWith("~/") ? path.join(home, target.slice(2)) : path.resolve(path.dirname(from.abs), target);
      if (!isFile(abs)) {
        findings.push({ severity: "warning", where, message: `\`@${target}\` names no file, so nothing is imported; wrap it in backticks if it is not meant as an import` });
        continue;
      }
      const loads = from.loads.startsWith("never")
        ? `never loads: ${from.file}, which imports it, never loads`
        : depth + 1 > HOPS
          ? `never loads: its import at ${where} is past the ${HOPS} hops Claude Code follows`
          : from.loads;
      const inside = abs.startsWith(root + path.sep);
      const file = inside ? relative(root, abs) : shown(abs, home);
      // Only Markdown is opened; a file of another kind is listed by name.
      const opened = !abs.endsWith(".md") || read(abs, file) !== null;
      const entry = { file, abs, loads, when: !opened ? UNREADABLE : loads.startsWith("never") ? loads : `${loads}, imported at ${where}` };
      if (add(inside ? inRepo : outside, entry) && inside && abs.endsWith(".md")) queue.push({ entry, depth: depth + 1 });
    }
  }
  return { inRepo, outside, findings };
}

// -> [{ file, lines }] for every file read for claims: the Markdown instruction files in the repo,
// then the other docs, the kit's stamped rules left out.
function claimDocs(root, inRepo, read) {
  const files = [
    ...inRepo.filter((e) => e.file.endsWith(".md")).map((e) => e.file),
    ...DOCS.filter((f) => lexists(path.join(root, f))),
    ...entries(path.join(root, ".claude", "agents")).filter((e) => !e.dir && e.name.endsWith(".md")).map((e) => `.claude/agents/${e.name}`),
    ...entries(path.join(root, ".claude", "skills")).filter((e) => e.dir && lexists(path.join(root, ".claude", "skills", e.name, "SKILL.md"))).map((e) => `.claude/skills/${e.name}/SKILL.md`),
  ];
  return [...new Set(files)]
    .map((file) => ({ file, text: read(path.join(root, file), file) }))
    .filter(({ text }) => text !== null && !isKitRule(text))
    .map(({ file, text }) => ({ file, lines: text.split("\n") }));
}

// What the load log saw: for each file listed, the logged sessions that loaded it, then any
// logged file the lists leave out.
function loadLog(root, config, home, listed) {
  let records = [];
  try {
    records = readFileSync(loadLogFile(root, home), "utf8")
      .split("\n")
      .flatMap((line) => {
        try {
          const r = JSON.parse(line);
          return [r.session, r.file, r.time].every((v) => typeof v === "string") ? [r] : [];
        } catch {
          return [];
        }
      });
  } catch {
    // No log yet.
  }
  if (!records.length) {
    return [
      config.hooks?.loadLog === true
        ? "no session is logged here yet"
        : "off: switch on hooks.loadLog in .claude/odyssey.json, and each session's loads are logged here",
    ];
  }
  const real = (file) => {
    try {
      return realpathSync.native(file);
    } catch {
      return path.resolve(file);
    }
  };
  const sessions = new Map();
  for (const r of records) {
    if (!sessions.has(r.session)) sessions.set(r.session, new Set());
    sessions.get(r.session).add(real(r.file));
  }
  const total = sessions.size;
  const count = (abs) => [...sessions.values()].filter((files) => files.has(abs)).length;
  // Parallel loads can append out of order, so the last session is the latest time, not the last line.
  const last = records.reduce((latest, r) => (r.time > latest ? r.time : latest), "");
  const out = [`${total} session${total === 1 ? "" : "s"} logged, the last at ${last}`];
  const named = new Set();
  for (const e of listed) {
    const abs = real(e.abs);
    named.add(abs);
    out.push(`${e.file}: loaded in ${count(abs)} of ${total}${e.fallback ? "; Claude Code sends no load event for this file" : ""}`);
  }
  for (const abs of new Set([...sessions.values()].flatMap((files) => [...files]))) {
    if (named.has(abs)) continue;
    const file = abs.startsWith(root + path.sep) ? relative(root, abs) : shown(abs, home);
    out.push(`${file}: loaded in ${count(abs)} of ${total}, and on neither list above`);
  }
  return out;
}

// Backticked spans and link targets outside fenced code. -> [{ token, line }]
export function pathTokens(lines) {
  const out = [];
  let fenced = false;
  lines.forEach((text, i) => {
    if (/^\s*(```|~~~)/.test(text)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    for (const m of text.matchAll(/`([^`]+)`/g)) out.push({ token: m[1], line: i + 1 });
    for (const m of text.matchAll(/\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g)) out.push({ token: m[1], line: i + 1 });
  });
  return out;
}

// The repo path a token claims, or null when it is not a path claim: prose, commands, URLs,
// absolute and home paths, variables, flags, globs, placeholders, bare extensions, dotted
// identifiers, branch names and owner/repo pairs. An ADR number goes to the ADR check.
export function asRepoPath(raw, root, docDir) {
  const token = raw.trim().replace(/#.*$/, "").replace(/:\d+(?:[-–]\d+)?$/, "");
  if (!token || /\s/.test(token)) return null;
  if (/[:<>{}()[\]=@"',*$…+]|\.\.\.|000N|NNNN/.test(token)) return null;
  if (/^[/~-]/.test(token)) return null;
  if (/^\.[A-Za-z0-9]+$/.test(token)) return null;
  if (/^docs\/adr\/\d{4}/.test(token) && !token.endsWith(".md")) return null;
  const last = token.replace(/\/+$/, "").split("/").pop();
  const ext = last.includes(".") ? last.split(".").pop().toLowerCase() : "";
  const hasExt = FILE_EXTENSIONS.has(ext);
  if (!token.includes("/")) return hasExt ? token : null;
  if (hasExt || token.endsWith("/")) return token;
  const first = token.split("/")[0];
  if (first === "." || first === "..") return token;
  return lexists(path.join(root, first)) || lexists(path.join(root, docDir, first)) ? token : null;
}

function resolvesInRepo(root, docDir, token) {
  const target = token.replace(/\/+$/, "");
  for (const base of [root, path.join(root, docDir)]) {
    const abs = path.resolve(base, target);
    if (abs !== root && !abs.startsWith(root + path.sep)) continue;
    if (lexists(abs)) return true;
  }
  return false;
}

// Whether git ignores the token, passed as written: a directory pattern (dist/) matches `dist/`,
// not `dist`. -> true or false, or git's own reason when it could not say, which is never read
// as either answer.
function ignored(root, token) {
  const r = spawnSync("git", ["check-ignore", "-q", "--", token], { cwd: root, encoding: "utf8" });
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  return (r.error?.code ?? r.stderr?.trim().split("\n")[0]) || `git exited ${r.status}`;
}

// Every file name under the roots, for a bare file-name claim; names only, nothing is opened.
function basenames(root, roots) {
  const names = new Set();
  const walk = (rel) => {
    for (const e of entries(path.join(root, rel))) {
      if (e.dir) {
        if (!SKIP_DIRS.has(e.name)) walk(`${rel}/${e.name}`);
      } else names.add(e.name);
    }
  };
  for (const r of roots) walk(r);
  return names;
}

function checkPaths(root, docs, config) {
  const findings = [];
  const roots = [...new Set([...BASENAME_ROOTS, ...(config.srcDirs ?? []), ...(config.testDirs ?? [])])];
  let names;
  for (const doc of docs) {
    const docDir = path.dirname(doc.file);
    const seen = new Set();
    for (const { token: raw, line } of pathTokens(doc.lines)) {
      const token = asRepoPath(raw, root, docDir);
      if (token === null || seen.has(`${line} ${token}`)) continue;
      seen.add(`${line} ${token}`);
      if (resolvesInRepo(root, docDir, token)) continue;
      const where = `${doc.file}:${line}`;
      if (!token.includes("/")) {
        names ??= basenames(root, roots);
        if (names.has(token)) continue;
      }
      const git = ignored(root, token);
      if (git === true) {
        findings.push({ severity: "warning", where, message: `\`${token}\` does not exist here; git ignores it, so a build may create it` });
      } else if (git !== false) {
        findings.push({ severity: "error", where, message: `\`${token}\` does not exist, and git could not say whether it ignores it (${git})` });
      } else if (!token.includes("/")) {
        findings.push({ severity: "error", where, message: `\`${token}\` does not exist (no file of that name under ${roots.map((r) => `${r}/`).join(", ")})` });
      } else {
        findings.push({ severity: "error", where, message: `\`${token}\` does not exist (resolved from the repo root and from ${docDir === "." ? "the root" : `${docDir}/`})` });
      }
    }
  }
  return findings;
}

function checkScripts(root, docs) {
  const file = path.join(root, "package.json");
  if (!lexists(file)) return [{ severity: "info", where: "", message: "no package.json here; the scripts check is skipped" }];
  let scripts;
  try {
    scripts = new Set(Object.keys(JSON.parse(readFileSync(file, "utf8")).scripts ?? {}));
  } catch {
    return [{ severity: "error", where: "package.json:1", message: "package.json does not parse, so no `npm run` can be checked" }];
  }
  const findings = [];
  for (const doc of docs) {
    doc.lines.forEach((text, i) => {
      // `npm test` and `npm start` are the shorthands for those scripts.
      for (const m of text.matchAll(/\bnpm\s+(?:run(?:-script)?\s+([A-Za-z][\w:.-]*)|(test|start)\b)/g)) {
        const name = (m[1] ?? m[2]).replace(/[.:]+$/, "");
        if (!scripts.has(name)) findings.push({ severity: "error", where: `${doc.file}:${i + 1}`, message: `\`${m[0]}\` names no package.json script "${name}"` });
      }
    });
  }
  return findings;
}

const pad = (n) => String(n).padStart(4, "0");

function checkAdrs(root, docs) {
  const numbers = new Set(
    entries(path.join(root, "docs", "adr"))
      .map((e) => /^(\d{4})-.*\.md$/.exec(e.name)?.[1])
      .filter(Boolean)
      .map(Number),
  );
  const lowest = Math.min(...numbers);
  const highest = Math.max(...numbers);
  const findings = [];
  for (const doc of docs) {
    doc.lines.forEach((text, i) => {
      const where = `${doc.file}:${i + 1}`;
      for (const m of text.matchAll(/\bADRs?\s+(\d{4})\b|docs\/adr\/(\d{4})/g)) {
        const n = Number(m[1] ?? m[2]);
        if (numbers.has(n)) continue;
        const held = numbers.size ? `it runs ${pad(lowest)}–${pad(highest)}` : "it holds no NNNN-*.md file";
        findings.push({ severity: "error", where, message: `${m[0]} cites an ADR that docs/adr/ does not hold (${held})` });
      }
      // A range's second number is checked here (the first matched above), and a range from
      // the first ADR reads as "all of them", so it goes stale as ADRs land.
      for (const m of text.matchAll(/(?:\bADRs?\s+|docs\/adr\/)(\d{4})`?\s*(?:–|—|-|to|through)\s*`?(?:docs\/adr\/)?(\d{4})\b/g)) {
        if (!numbers.has(Number(m[2]))) {
          findings.push({ severity: "error", where, message: `range ${pad(m[1])}–${pad(m[2])} ends at an ADR that docs/adr/ does not hold` });
        } else if (numbers.size && Number(m[1]) === lowest && Number(m[2]) < highest) {
          findings.push({ severity: "error", where, message: `range ${pad(m[1])}–${pad(m[2])} stops short: docs/adr/ runs to ${pad(highest)}` });
        }
      }
    });
  }
  return findings;
}

function checkShadowing(root, home) {
  const personal = path.join(home, ".claude");
  if (!existsSync(personal)) return [{ severity: "info", where: "", message: `no ${personal}; the shadowing check is skipped` }];
  const findings = [];
  const skills = entries(path.join(root, ".claude", "skills")).filter((e) => e.dir && lexists(path.join(root, ".claude", "skills", e.name, "SKILL.md")));
  for (const { name } of skills) {
    const mine = path.join(personal, "skills", name, "SKILL.md");
    if (!existsSync(mine)) continue;
    let same;
    try {
      same = readFileSync(mine).equals(readFileSync(path.join(root, ".claude", "skills", name, "SKILL.md")));
    } catch {
      continue; // a copy that can't be read loads nowhere, so it shadows nothing; the report names the repo's
    }
    findings.push({
      severity: "warning",
      where: `.claude/skills/${name}/SKILL.md`,
      message: `shadowed by ~/.claude/skills/${name}/SKILL.md (${same ? "byte-identical" : "contents differ"}): a personal skill loads instead of a project skill of the same name, so this copy never runs`,
    });
  }
  for (const { name, dir } of entries(path.join(root, ".claude", "agents"))) {
    if (!dir && name.endsWith(".md") && existsSync(path.join(personal, "agents", name))) {
      findings.push({ severity: "info", where: `.claude/agents/${name}`, message: `~/.claude/agents/${name} shares the name; the project copy wins` });
    }
  }
  return findings;
}

// -> { text, errors, warnings }. `config` is the resolved config (srcDirs and testDirs widen
// where a bare file name may live, and hooks.loadLog says whether a load log is kept); `home`
// is the folder whose .claude holds your own instruction files, skills and the load log.
export function docsCheck(root, config, home) {
  const unreadable = [];
  const read = reader(unreadable);
  const { inRepo, outside, findings } = walk(root, home, read);
  const docs = claimDocs(root, inRepo, read);
  const listed = (list) => (list.length ? list.map((e) => `${e.file}: ${e.when}${e.kit ? "; a kit rule, so its claims are not checked" : ""}`) : ["none"]);
  const out = [
    `Docs check in ${root}: ${docs.length} file${docs.length === 1 ? "" : "s"} checked.`,
    "== instruction files ==",
    ...listed(inRepo),
    "== outside the repo, read for conflicts only ==",
    ...listed(outside),
    "== load log ==",
    ...loadLog(root, config, home, [...inRepo, ...outside]),
  ];
  const groups = [
    ["imports", findings],
    ["paths", checkPaths(root, docs, config)],
    ["scripts", checkScripts(root, docs)],
    ["ADR citations", checkAdrs(root, docs)],
    ["shadowing", checkShadowing(root, home)],
    ["unreadable files", unreadable],
  ];
  let errors = 0;
  let warnings = 0;
  for (const [name, list] of groups) {
    out.push(`== ${name} ==`);
    if (!list.some((f) => f.severity !== "info")) out.push("ok");
    for (const f of list) {
      if (f.severity === "error") errors += 1;
      if (f.severity === "warning") warnings += 1;
      out.push(f.where ? `${f.where} ${f.severity}: ${f.message}` : `${f.severity}: ${f.message}`);
    }
  }
  out.push(errors + warnings === 0 ? "docs check: clean" : `docs check: ${errors} error(s), ${warnings} warning(s)`);
  return { text: out.join("\n"), errors, warnings };
}
