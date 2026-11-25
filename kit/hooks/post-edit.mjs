#!/usr/bin/env node
// PostToolUse hook: format the file Claude just edited, then check its imports.
//
// Two opt-in steps, each switched on in .claude/odyssey.json, run in this order:
//   hooks.formatOnEdit       -> format + lint-fix the file with the repo's own Prettier
//                               and ESLint. That runs code from node_modules, so it runs
//                               only after the user trusts it for this repo.
//   hooks.esmImportExtension -> enforce the ESM/NodeNext ".js extension on relative
//                               imports" invariant, on the file as formatted.
//
// Auto-fixing on edit removes a whole class of review findings before commit.
// In a "type": "module" project with moduleResolution NodeNext, relative imports
// in .ts source must carry the .js extension (import { x } from "./thing.js").
// Without the check a missing extension only surfaces at typecheck/build time -
// this gives immediate edit-time feedback so the mistake never reaches the gate.
//
// Exit 2 surfaces the listed violations back to Claude (the edit already
// happened - this is a "now fix it" signal, not a block). Exit 0 otherwise: the
// formatter never blocks an edit, and tsc/CI stay the hard gate.
// It runs the nearest Prettier and ESLint installed from the edited file's folder up to
// the git root (lib/trust.mjs); with none installed, formatting no-ops.
// A file in a linked git worktree of the session's repo is formatted and checked with that
// worktree's config and root, as a session started there would (lib/config.mjs, configFor).
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { configFor, hookInput, noticeOnce, repoDir } from "../lib/config.mjs";
import { FORMATTER, isTrusted, localBin, untrusted } from "../lib/trust.mjs";

let input;
try {
  input = hookInput();
} catch {
  process.exit(0);
}
const { payload } = input;
const filePath = payload?.tool_input?.file_path;
if (!filePath || !input.root) process.exit(0);

// Resolve symlinks on both sides, so a link inside the repo that points outside it is
// judged by where a write would actually land. `root` is already a real path.
const requested = path.resolve(input.root, filePath);
const abs = existsSync(requested) ? realpathSync.native(requested) : requested;

// A file in a linked git worktree of this repo is checked as that worktree's own session
// would check it, with the config and the root it gives.
const forFile = configFor(path.dirname(abs), input);
if (forFile.notice) noticeOnce(payload, forFile.notice);
const { root, config } = forFile;
const format = config.hooks?.formatOnEdit === true;
const checkImports = config.hooks?.esmImportExtension === true;
if (!format && !checkImports) process.exit(0);

// Only touch files inside this repo; skip generated/vendor trees and missing files.
// Segment-aware containment via path.relative, not a string prefix - a sibling
// like /repo-evil must not pass by sharing the /repo prefix.
const relToRoot = path.relative(root, abs);
if (relToRoot === "" || relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
  process.exit(0);
}
const rel = relToRoot.split(path.sep).join("/");
// A node_modules or dist folder between the root and the file. The folders above the root
// don't count, so a repo that sits in a folder named dist is checked like any other.
if (rel.split("/").slice(0, -1).some((dir) => dir === "node_modules" || dir === "dist")) {
  process.exit(0);
}
if (!existsSync(abs)) process.exit(0);

const ext = path.extname(abs).toLowerCase();
// srcDirs and testDirs, relative to the repo root: "src", "./src" and "src/" all mean src/.
const inSourceDirs = [...(config.srcDirs ?? ["src"]), ...(config.testDirs ?? ["test"])]
  .map(repoDir)
  .some((dir) => dir === "" || rel === dir || rel.startsWith(`${dir}/`));

// --- 1. Format (hooks.formatOnEdit), trusted only ---------------------------------
let formatterSkipped = false;
const prettierExts = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".yaml", ".yml"]);
// A formatter rewrites the whole file, so it never touches one protect-append-only guards:
// it would reflow the entries already there.
const guarded = new Set(
  [...(config.protect?.appendOnly ?? []), ...(config.protect?.readOnly ?? [])].map((name) => name.toLowerCase()),
);
if (format && prettierExts.has(ext) && !guarded.has(path.basename(abs).toLowerCase())) {
  if (isTrusted(root, FORMATTER)) {
    // Run the locally-installed formatter/linter binaries through Node directly.
    // Invoke `node <local-bin>` with shell:false so the edited path is passed as a
    // plain argv entry - never concatenated into a shell command line. This closes
    // the filename-metacharacter injection surface (a Windows .cmd shim under
    // shell:true would interpret them, and Node refuses to spawn .cmd with
    // shell:false at all) while still running the repo's own devDependency offline.
    const run = (pkg, file, args) => {
      const bin = localBin(root, path.dirname(abs), pkg, file);
      if (!bin) return; // formatter absent here - never block the edit
      // Bound the run with a timeout so a hung formatter can't stall the edit -
      // spawnSync terminates the child itself on timeout, and we never inspect its
      // status, so this stays fire-and-forget and never blocks the edit.
      spawnSync(process.execPath, [bin, ...args], {
        cwd: root,
        stdio: "ignore",
        shell: false,
        timeout: 10_000,
        killSignal: "SIGKILL",
      });
    };

    run("prettier", "bin/prettier.cjs", ["--write", abs]);

    const lintable = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
    if (lintable.has(ext) && inSourceDirs) {
      run("eslint", "bin/eslint.js", ["--fix", abs]);
    }
  } else {
    formatterSkipped = true;
  }
}

// --- 2. Import check (hooks.esmImportExtension) -----------------------------------
if (checkImports && [".ts", ".tsx", ".mts", ".cts"].includes(ext) && inSourceDirs) {
  let source = "";
  try {
    source = readFileSync(abs, "utf8");
  } catch {
    // unreadable: nothing to check
  }

  // Relative specifiers may legitimately end in one of these - everything else needs .js.
  const ALLOWED = [".js", ".jsx", ".mjs", ".cjs", ".json", ".node"];
  // Matches: from "..." | from '...' | import "..." (side-effect) | import("...") (dynamic).
  // Keys on the `from` keyword (not `import`), so export-from relative specifiers
  // ("export { x } from './x'", "export * from './x'") are matched and validated too.
  const SPECIFIER = /(?:from\s*|import\s*|import\s*\(\s*)["']([^"']+)["']/g;

  const violations = [];
  const lines = source.split(/\r?\n/);
  lines.forEach((line, i) => {
    // Skip comment-only lines cheaply to avoid flagging commented-out imports.
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
    let m;
    SPECIFIER.lastIndex = 0;
    while ((m = SPECIFIER.exec(line)) !== null) {
      const spec = m[1];
      if (!spec.startsWith(".")) continue; // package import - not our concern
      const hasExt = ALLOWED.some((e) => spec.endsWith(e));
      if (!hasExt) violations.push({ line: i + 1, spec });
    }
  });

  if (violations.length > 0) {
    const list = violations.map((v) => `  ${rel}:${v.line}  "${v.spec}"  -> add the ".js" extension`).join("\n");
    process.stderr.write(
      `ESM invariant: relative imports must carry the ".js" extension (NodeNext / "type":"module").\n` +
        `${violations.length} specifier(s) need fixing in ${rel}:\n${list}\n` +
        `Append ".js" to each relative specifier (e.g. "./config/env" -> "./config/env.js").\n`,
    );
    process.exit(2);
  }
}

// Said only on a clean exit, so it never mixes with the violations report.
if (formatterSkipped) noticeOnce(payload, untrusted("post-edit's formatter", root));
process.exit(0);
