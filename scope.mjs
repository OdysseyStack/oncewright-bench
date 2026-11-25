// Which files a run changed, and which of them a task's allowed.txt doesn't cover.
//   node scope.mjs <tree> <base> <allowed.txt>
// prints each out-of-scope file and exits 1 when there is one. score-g.mjs and fix.mjs use it.
// Changed = tracked files that differ from <base> in the working tree or on any local branch,
// plus untracked files git doesn't ignore. Every tree may also touch CHANGELOG.md, where the
// kit records a one-off request (and where a plain run may note one too). A kit tree (its base
// carries .claude/odyssey.json) may also touch directives/**, the kit's own working folder.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// GIT_OPTIONAL_LOCKS=0: reading the tree never rewrites its index.
const git = (tree, ...args) =>
  execFileSync("git", ["-C", tree, ...args], { encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, stdio: ["ignore", "pipe", "ignore"] })
    .split("\n")
    .filter(Boolean);

export function changedFiles(tree, base) {
  const files = new Set([
    ...git(tree, "diff", "--name-only", "--no-renames", base),
    ...git(tree, "ls-files", "--others", "--exclude-standard"),
  ]);
  for (const branch of git(tree, "for-each-ref", "--format=%(refname:short)", "refs/heads")) {
    for (const file of git(tree, "diff", "--name-only", "--no-renames", base, branch)) files.add(file);
  }
  return [...files].sort();
}

export function outOfScope(tree, base, allowedFile) {
  const globs = fs
    .readFileSync(allowedFile, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  globs.push("CHANGELOG.md");
  try {
    git(tree, "cat-file", "-e", `${base}:.claude/odyssey.json`);
    globs.push("directives/**");
  } catch {
    // the plain side's base: no kit
  }
  return changedFiles(tree, base).filter((file) => !globs.some((glob) => path.matchesGlob(file, glob)));
}

if (import.meta.main) {
  const [tree, base, allowed] = process.argv.slice(2);
  if (!allowed) {
    console.error("Usage: node scope.mjs <tree> <base> <allowed.txt>");
    process.exit(2);
  }
  const out = outOfScope(tree, base, allowed);
  for (const file of out) console.log(`out of scope: ${file}`);
  process.exit(out.length ? 1 : 0);
}
