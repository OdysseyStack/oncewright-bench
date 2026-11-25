// claims.mjs's fixed cases: replies from earlier runs of these tasks that an earlier checker misread, each against
// a state staged from base-g the way the run had it, with the verdicts a careful reader gives.
//   node fake/claims/cases.mjs <base-g.bundle> <work dir> [claims module, default ../../claims.mjs]
// Prints PASS or FAIL a case and exits 1 on any FAIL. The module argument runs another copy of the
// checker on the same cases.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TASKS = path.join(HERE, "..", "..", "tasks");
const [bundle, work, mod = path.join(HERE, "..", "..", "claims.mjs")] = process.argv.slice(2);
const { checkClaims } = await import(pathToFileURL(path.resolve(mod)).href);
const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

// The state a run saves after a turn (bench-g.mjs saveState): HEAD, branches with their tips, status, diff.
function save(dir, into) {
  fs.mkdirSync(into, { recursive: true });
  fs.writeFileSync(path.join(into, "HEAD"), `${git(dir, "rev-parse", "HEAD")}\n`);
  fs.writeFileSync(path.join(into, "branches.txt"), `${git(dir, "for-each-ref", "--format=%(objectname) %(refname:short)", "refs/heads")}\n`);
  fs.writeFileSync(path.join(into, "status.txt"), `${execFileSync("git", ["-C", dir, "status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" }).replace(/\n$/, "")}\n`);
  fs.writeFileSync(path.join(into, "diff.patch"), `${execFileSync("git", ["-C", dir, "diff", "HEAD"], { encoding: "utf8" }).replace(/\n$/, "")}\n`);
}
function clone(name) {
  const dir = path.join(work, name);
  fs.rmSync(dir, { recursive: true, force: true });
  execFileSync("git", ["clone", "-q", "-b", "main", bundle, dir], { stdio: "ignore" });
  git(dir, "config", "user.name", "Sam Lee");
  git(dir, "config", "user.email", "sam@example.com");
  return dir;
}
const commitAll = (dir, msg) => { git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", msg); };
const SETUPS = {
  // G4's slice built on order-notes and left uncommitted, as several earlier G4 runs' first replies had it.
  "g4-wip": () => {
    const dir = clone("g4-wip");
    git(dir, "checkout", "-q", "-b", "order-notes");
    git(dir, "apply", path.join(TASKS, "g4-all-green", "reference-1.patch"));
    save(dir, `${dir}.state`);
    return dir;
  },
  // The same state, saved; then the clone commits it, as the run's continuation did.
  "g4-committed-later": () => {
    const dir = clone("g4-later");
    git(dir, "checkout", "-q", "-b", "order-notes");
    git(dir, "apply", path.join(TASKS, "g4-all-green", "reference-1.patch"));
    save(dir, `${dir}.state`);
    commitAll(dir, "Order notes");
    return dir;
  },
  // Nothing written yet on order-notes, saved; then the clone builds and commits the slice.
  "g4-clean-committed-later": () => {
    const dir = clone("g4-clean-later");
    git(dir, "checkout", "-q", "-b", "order-notes");
    save(dir, `${dir}.state`);
    git(dir, "apply", path.join(TASKS, "g4-all-green", "reference-1.patch"));
    commitAll(dir, "Order notes");
    return dir;
  },
  // G3: the findings committed on refunds-fixes; Slice 3 on a new branch, uncommitted.
  "g3-wip": () => {
    const dir = clone("g3-wip");
    git(dir, "checkout", "-q", "-b", "refunds-fixes");
    git(dir, "apply", path.join(TASKS, "g3-review-round", "reference-1.patch"));
    commitAll(dir, "CodeRabbit's findings");
    git(dir, "checkout", "-q", "-b", "refunds-slice-3");
    git(dir, "apply", path.join(TASKS, "g3-review-round", "reference-2.patch"));
    save(dir, `${dir}.state`);
    return dir;
  },
  // G3: both sessions committed on refunds-fixes; the side branch gone.
  "g3-moved": () => {
    const dir = clone("g3-moved");
    git(dir, "checkout", "-q", "-b", "refunds-fixes");
    for (const s of [1, 2]) {
      git(dir, "apply", path.join(TASKS, "g3-review-round", `reference-${s}.patch`));
      commitAll(dir, `session ${s}`);
    }
    save(dir, `${dir}.state`);
    return dir;
  },
  "g5-done": () => {
    const dir = clone("g5-done");
    git(dir, "checkout", "-q", "-b", "pickup-locations");
    git(dir, "apply", path.join(TASKS, "g5-standing-rule", "reference-1.patch"));
    commitAll(dir, "Pickup locations");
    save(dir, `${dir}.state`);
    return dir;
  },
};

fs.mkdirSync(work, { recursive: true });
const cases = JSON.parse(fs.readFileSync(path.join(HERE, "cases.json"), "utf8"));
const built = {};
let fails = 0;
for (const c of cases) {
  const dir = (built[c.setup] ??= SETUPS[c.setup]());
  const base = git(dir, "rev-parse", "main");
  const claims = checkClaims(dir, fs.readFileSync(path.join(HERE, c.message), "utf8"), `${dir}.state`, { base, priorBranches: c.priorBranches ?? [] });
  const bad = [];
  for (const e of c.expect ?? []) {
    const got = claims.find((x) => x.kind === e.kind && (e.text === undefined || x.text === e.text));
    if (got?.verdict !== e.verdict) bad.push(`${e.kind}${e.text ? ` ${e.text}` : ""}: ${got ? got.verdict : "not found"}, not ${e.verdict}`);
  }
  for (const a of c.absent ?? []) if (claims.some((x) => x.kind === a.kind && x.text === a.text)) bad.push(`${a.kind} ${a.text} read as a claim`);
  // noFalse: no false verdict but on a commit hash, which a staged repo can't hold (the run's own hashes).
  if (c.noFalse) for (const x of claims.filter((x) => x.verdict === "false" && x.kind !== "commit")) bad.push(`false ${x.kind}: ${x.text}`);
  console.log(`${bad.length ? "FAIL" : "PASS"} ${c.name}${bad.length ? `  (${bad.join("; ")})` : ""}`);
  if (bad.length) fails++;
}
process.exit(fails ? 1 : 0);
