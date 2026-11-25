// Checks for scripts/odyssey.mjs: `config` resolves the one config per session
// and checks it against the bundled schema, `trust` approves, lists and revokes the
// commands the hooks may run, /odyssey:setup's `plan`, `apply`, `status` and
// `doctor` write, upgrade and check a repo's kit files, `docs check` lists
// the instruction files with when each loads and reads their claims against the repo, every
// skill description reads whole, and every `odyssey:` name the kit's text uses is one of its
// skills.
//
// Each check runs the script as a process, the way skills and users do, in scratch
// repos under the temp dir (a `.git` directory marks each repo root, which is all the
// resolver looks for). HOME points at a scratch home, so the trust file is never the
// real one. Offline and deterministic: no command the configs name is ever run here,
// and doctor's canaries run the plugin's own guards.
//
// Run: node --test scripts/odyssey.test.mjs
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT = fileURLToPath(new URL("./odyssey.mjs", import.meta.url));
const PLUGIN = path.dirname(path.dirname(SCRIPT));
// Spelled as the file system spells it, which is how the script names a repo's root.
delete process.env.CLAUDE_CONFIG_DIR; // the machine extras follow it; every test here sets its own HOME
const scratch = realpathSync.native(mkdtempSync(path.join(tmpdir(), "odyssey-script-")));
const home = path.join(scratch, "home");
mkdirSync(home);

after(() => {
  // Verify the location before anything destructive, as protect-env.test.mjs does.
  assert.ok(scratch.startsWith(realpathSync.native(tmpdir()) + path.sep), "scratch dir is under tmpdir");
  assert.ok(path.basename(scratch).startsWith("odyssey-script-"), "scratch dir is ours");
  rmSync(scratch, { recursive: true, force: true });
});

// A directory under the scratch dir, optionally a repo root (.git) and holding a config:
// an object is written as JSON, a string as is.
function dir(name, { git = true, config } = {}) {
  const at = path.join(scratch, name);
  mkdirSync(git ? path.join(at, ".git") : at, { recursive: true });
  if (config !== undefined) {
    mkdirSync(path.join(at, ".claude"), { recursive: true });
    const text = typeof config === "string" ? config : JSON.stringify(config);
    writeFileSync(path.join(at, ".claude", "odyssey.json"), text);
  }
  return at;
}

const env = (project) => ({ ...process.env, CLAUDE_PROJECT_DIR: project, HOME: home, USERPROFILE: home });

function odyssey(args, { cwd, project, node = [], script = SCRIPT } = {}) {
  return spawnSync(process.execPath, [...node, script, ...args], { cwd, env: env(project), encoding: "utf8" });
}

const resolved = (options) => JSON.parse(odyssey(["config"], options).stdout);
const trustRecords = () =>
  JSON.parse(readFileSync(path.join(home, ".claude", "odyssey-trust.json"), "utf8")).trusted;

test("config finds the root config from a subdirectory start", () => {
  const root = dir("nested", { config: { version: 1, project: "nested" } });
  mkdirSync(path.join(root, "src", "deep"), { recursive: true });
  const found = resolved({ cwd: path.join(root, "src", "deep") });
  assert.equal(found.file, path.join(root, ".claude", "odyssey.json"));
  assert.equal(found.root, root);
  assert.equal(found.config.project, "nested");
  assert.equal(found.notice, null);
});

test("config starts at CLAUDE_PROJECT_DIR, not a moved cwd", () => {
  const started = dir("started", { config: { version: 1, project: "started" } });
  const movedTo = dir("moved-to", { config: { version: 1, project: "moved-to" } });
  assert.equal(resolved({ cwd: movedTo, project: started }).config.project, "started");
});

test("config stops at the git root", () => {
  dir("outer", { git: false, config: { version: 1, project: "outer" } });
  const inner = dir(path.join("outer", "inner"));
  const found = resolved({ cwd: inner });
  assert.equal(found.file, null, "the config above the git root is not read");
  assert.equal(found.root, inner);
  assert.deepEqual(found.config, {});
});

test("a schema-invalid config resolves to defaults with one notice", () => {
  const cases = [
    [{ version: 1, hooks: { typecheckGate: { enabled: true, timeoutSec: "60" } } }, /hooks\.typecheckGate\.timeoutSec: expected integer/],
    [{ version: 1, hooks: { protectManifst: true } }, /hooks: unknown key "protectManifst"/],
    [{ hooks: {} }, /the top level: missing "version"/],
    [{ version: 2 }, /version: expected 1/],
    [{ version: 1, protect: { readOnly: ["docs/log.md"] } }, /protect\.readOnly\[0\]: expected a file name, not a path/],
    [{ version: 1, docs: { plan: "" } }, /docs\.plan: empty/],
    ["{ not json", /is invalid \(/],
  ];
  cases.forEach(([config, problem], i) => {
    const found = resolved({ cwd: dir(`invalid-${i}`, { config }) });
    assert.deepEqual(found.config, {}, "defaults");
    assert.match(found.notice, problem);
    assert.match(found.notice, /opt-in hooks are off/);
    assert.equal(found.notice.split("\n").length, 1, "one notice, one line");
  });
});

test("a config using every key is valid", () => {
  const config = {
    $schema: "https://raw.githubusercontent.com/OdysseyStack/oncewright/main/schema/odyssey.v1.json",
    version: 1,
    project: "demo",
    srcDirs: ["src", "lib"],
    testDirs: ["test"],
    gate: { stages: [{ name: "test", command: "npm test" }], fix: ["npm run lint -- --fix"] },
    db: { schemaFile: "src/db/schema.ts", seedFile: "src/db/seed.ts", generate: "npm run db:generate", migrate: "npm run db:migrate", seed: "npm run db:seed" },
    docs: { plan: "docs/plan.md", check: "npm run docs:check" },
    protect: { appendOnly: ["journal.md"], readOnly: ["audit-log.md"], secrets: [".npmrc"], manifests: ["Cargo.toml"] },
    hooks: {
      protectManifest: true,
      protectAppendOnly: true,
      formatOnEdit: true,
      esmImportExtension: true,
      loadLog: true,
      typecheckGate: { enabled: true, command: "npx tsc --noEmit", timeoutSec: 120 },
    },
  };
  const found = resolved({ cwd: dir("every-key", { config }) });
  assert.equal(found.notice, null);
  assert.deepEqual(found.config, config);
});

test("a config written before the docs matrix was retired stays valid, its old keys unread", () => {
  const config = {
    version: 1,
    docs: { plan: "docs/plan.md", roadmap: "docs/ROADMAP.md", deploy: "docs/deploy.md", deployManifest: "render.yaml", always: [{ file: "docs/state.md" }] },
    metaSync: { vendor_contract: { files: ["docs/vendor-api.md"], paths: ["src/vendor/**"] } },
  };
  const found = resolved({ cwd: dir("retired-keys", { config }) });
  assert.equal(found.notice, null);
  const schema = JSON.parse(readFileSync(path.join(PLUGIN, "schema", "odyssey.v1.json"), "utf8")).properties;
  for (const key of ["roadmap", "deploy", "deployManifest", "always"]) assert.match(schema.docs.properties[key].description, /^Retired: no longer read\./);
  assert.match(schema.metaSync.description, /^Retired: no longer read\./);
});

test("trust approve records the configured commands, list shows them, and revoke drops them", () => {
  const config = { version: 1, hooks: { formatOnEdit: true, typecheckGate: { enabled: true, command: "npx tsc --noEmit" } } };
  const root = dir("trusting", { config });
  const approved = odyssey(["trust", "approve"], { cwd: root });
  assert.equal(approved.status, 0);
  assert.match(approved.stdout, /npx tsc --noEmit/, "approve shows what it trusts");
  assert.match(approved.stdout, /post-edit formatter/);
  assert.equal(odyssey(["trust", "approve"], { cwd: root }).status, 0);
  assert.deepEqual(
    trustRecords().map((record) => `${record.repo} ${record.command}`).sort(),
    [
      `${root} npx tsc --noEmit`,
      `${root} post-edit formatter: node_modules/prettier/bin/prettier.cjs and node_modules/eslint/bin/eslint.js`,
    ],
    "keyed by the repo's real path and the exact command, once each",
  );
  assert.match(odyssey(["trust", "list"]).stdout, /: npx tsc --noEmit\n/);
  // Revoke needs only the repo root, so a config broken since approval must not keep the trust.
  writeFileSync(path.join(root, ".claude", "odyssey.json"), JSON.stringify({ ...config, typo: true }));
  assert.equal(odyssey(["trust", "revoke"], { cwd: root }).status, 0);
  assert.deepEqual(trustRecords(), []);
});

test("two approvals at the same moment both land", async () => {
  const config = { version: 1, hooks: { formatOnEdit: true } };
  const roots = Array.from({ length: 12 }, (_, i) => dir(`same-moment-${i}`, { config }));
  const exits = await Promise.all(
    roots.map(
      (cwd) =>
        new Promise((resolve) => {
          spawn(process.execPath, [SCRIPT, "trust", "approve"], { cwd, env: env(undefined), stdio: "ignore" }).on("close", resolve);
        }),
    ),
  );
  assert.deepEqual(exits, roots.map(() => 0));
  assert.deepEqual(trustRecords().map((record) => record.repo).sort(), [...roots].sort(), "no approval is lost");
  assert.deepEqual(readdirSync(path.join(home, ".claude")), ["odyssey-trust.json"], "no lock or half-written file is left");
  for (const cwd of roots) assert.equal(odyssey(["trust", "revoke"], { cwd }).status, 0);
  assert.deepEqual(trustRecords(), []);
});

test("a lock another run holds is waited for and left alone, and the trust file is the user's alone", () => {
  const lock = path.join(home, ".claude", "odyssey-trust.json.lock");
  const root = dir("locked", { config: { version: 1, hooks: { formatOnEdit: true } } });
  assert.equal(odyssey(["trust", "approve"], { cwd: root }).status, 0);
  writeFileSync(lock, "4242");
  const waited = odyssey(["trust", "revoke"], { cwd: root });
  assert.equal(waited.status, 1);
  assert.match(waited.stderr, /was not changed\. Another trust update holds .*odyssey-trust\.json\.lock\. If none is running, delete that file\./);
  assert.equal(readFileSync(lock, "utf8"), "4242", "the lock is left alone");
  assert.deepEqual(trustRecords().map((record) => record.repo), [root], "and nothing was changed");
  rmSync(lock);
  assert.equal(odyssey(["trust", "revoke"], { cwd: root }).status, 0);
  if (process.platform !== "win32") {
    assert.equal(statSync(path.join(home, ".claude", "odyssey-trust.json")).mode & 0o077, 0, "only the user can read it");
  }
});

test("a trust file that can't be read is never written over, and an entry that is no record is skipped", () => {
  const file = path.join(home, ".claude", "odyssey-trust.json");
  const root = dir("damaged", { config: { version: 1, hooks: { typecheckGate: { enabled: true, command: "npx tsc --noEmit" } } } });
  const half = '{ "trusted": [ { "repo": "/srv/other", "comm';
  writeFileSync(file, half);
  for (const action of ["approve", "revoke"]) {
    const refused = odyssey(["trust", action], { cwd: root });
    assert.equal(refused.status, 1, action);
    assert.match(refused.stderr, /was not changed\. .*does not read as trust records\. Fix or delete it\. Then run this again\./);
  }
  assert.equal(readFileSync(file, "utf8"), half, "left as it was");
  const list = odyssey(["trust", "list"]);
  assert.equal(list.status, 1);
  assert.match(list.stderr, /does not read as trust records\. Fix or delete it\. Until then nothing is trusted\./);
  assert.match(odyssey(["status"], { cwd: root }).stdout, /^Not trusted, so it does not run: npx tsc --noEmit\./m);

  const other = { repo: "/srv/other", command: "make check" };
  writeFileSync(file, JSON.stringify({ trusted: [null, 7, { repo: root }, other] }));
  assert.equal(odyssey(["status"], { cwd: root }).status, 0);
  assert.equal(odyssey(["trust", "list"]).stdout, "/srv/other: make check\n");
  assert.equal(odyssey(["trust", "approve"], { cwd: root }).status, 0);
  assert.deepEqual(trustRecords(), [other, { repo: root, command: "npx tsc --noEmit" }]);
  writeFileSync(file, '{ "trusted": [] }\n');
});

test("trust approve refuses an invalid config and a config with nothing to run", () => {
  const invalid = odyssey(["trust", "approve"], { cwd: dir("approve-invalid", { config: { version: 1, hooks: { typo: true } } }) });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /is invalid/);
  const idle = odyssey(["trust", "approve"], { cwd: dir("approve-idle", { config: { version: 1, hooks: { protectManifest: true } } }) });
  assert.equal(idle.status, 1);
  assert.match(idle.stderr, /Nothing to approve/);
});

// --- /odyssey:setup: plan, apply, status, doctor ---------------------------------------

const VERSION = JSON.parse(readFileSync(path.join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8")).version;
const SCHEMA_ID = JSON.parse(readFileSync(path.join(PLUGIN, "schema", "odyssey.v1.json"), "utf8")).$id;
const RULES = path.join(PLUGIN, "scaffold", ".claude", "rules", "odyssey");
const KIT = readdirSync(RULES).sort();
const SLOTS = ["directives/handoff/current.md"];
// A kit-owned rule as setup writes it: the stamp over the scaffold copy.
const sha256 = (text) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
const scaffold = (name) => readFileSync(path.join(RULES, name), "utf8");
const stampedCopy = (name) => `<!-- odyssey-managed v${VERSION} sha256:${sha256(scaffold(name))} -->\n${scaffold(name)}`;

// The interview's answers, as /odyssey:setup writes them: config keys plus the two project rules.
const ANSWERS = {
  config: {
    project: "demo",
    srcDirs: ["src"],
    hooks: { protectManifest: true, typecheckGate: { enabled: true, command: "npx tsc --noEmit" } },
  },
  sensitiveData: { identifiers: ["email"], payloads: ["the webhook body"], credentials: [".env", "~/.zshenv"] },
  hotPath: { paths: ["src/checkout/**/*.ts"], invariants: ["No await before the charge call."] },
};
function answers(name, value) {
  const file = path.join(scratch, `${name}.answers.json`);
  writeFileSync(file, JSON.stringify(value));
  return file;
}

// Every file under `root` outside .git, with its bytes: a snapshot to compare.
function snapshot(root) {
  return readdirSync(root, { recursive: true })
    .filter((f) => f !== ".git" && !f.startsWith(`.git${path.sep}`) && statSync(path.join(root, f)).isFile())
    .sort()
    .map((f) => [f, readFileSync(path.join(root, f), "utf8")]);
}

test("apply writes each kit-owned rule as its scaffold copy under the stamp, and plan writes nothing", () => {
  const root = dir("setup-fresh");
  const file = answers("fresh", ANSWERS);
  const planned = odyssey(["plan", "--answers", file], { cwd: root });
  assert.equal(planned.status, 0);
  assert.match(planned.stdout, /^6 to write, 0 kept, 0 skipped\.$/m);
  assert.deepEqual(readdirSync(root), [".git"], "plan writes nothing");
  const applied = odyssey(["apply", "--answers", file], { cwd: root });
  assert.equal(applied.status, 0);
  assert.match(applied.stdout, /^6 written, 0 kept, 0 skipped\.$/m);
  assert.deepEqual(KIT, ["primary.md"]);
  for (const name of KIT) {
    assert.equal(readFileSync(path.join(root, ".claude", "rules", "odyssey", name), "utf8"), stampedCopy(name), name);
  }
  for (const slot of SLOTS) {
    assert.equal(readFileSync(path.join(root, slot), "utf8"), readFileSync(path.join(PLUGIN, "scaffold", slot), "utf8"), slot);
  }
});

test("a second apply writes nothing", () => {
  const root = dir("setup-twice");
  const file = answers("twice", ANSWERS);
  assert.equal(odyssey(["apply", "--answers", file], { cwd: root }).status, 0);
  const before = snapshot(root);
  const again = odyssey(["apply", "--answers", file], { cwd: root });
  assert.equal(again.status, 0);
  assert.match(again.stdout, /^0 written, 6 kept, 0 skipped\.$/m);
  assert.deepEqual(snapshot(root), before);
});

test("a file that already exists is never changed, and only the missing .gitignore lines are appended", () => {
  const root = dir("setup-existing");
  const mine = {
    ".claude/odyssey.json": '{ "version": 1 }\n',
    ".claude/rules/project.md": "# Our rules\n",
    ".claude/rules/sensitive-data.md": "# Our list\n",
    "directives/layer_3_work_orders/current.md": "a live work order\n",
    "directives/handoff/current.md": "a live handoff\n",
  };
  for (const [f, text] of Object.entries({ ...mine, ".gitignore": "node_modules/\ndirectives/handoff/" })) {
    mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    writeFileSync(path.join(root, f), text);
  }
  // A dangling link where setup would create hot-path.md: writing through it would create its target.
  const target = path.join(scratch, "linked-hot-path.md");
  symlinkSync(target, path.join(root, ".claude", "rules", "hot-path.md"));
  const applied = odyssey(["apply", "--answers", answers("existing", ANSWERS)], { cwd: root });
  assert.equal(applied.status, 0);
  for (const [f, text] of Object.entries(mine)) assert.equal(readFileSync(path.join(root, f), "utf8"), text, f);
  assert.equal(existsSync(target), false, "never written through a link");
  assert.match(applied.stdout, /kept +\.claude\/rules\/hot-path\.md +\(exists: setup never changes it\)/);
  assert.equal(
    readFileSync(path.join(root, ".gitignore"), "utf8"),
    "node_modules/\ndirectives/handoff/\nreferences/CR reviews/\n",
  );
});

test("upgrades: untouched and out of date is replaced, edited and deleted wait for --approve, a removed stamp is left alone", () => {
  const RULE = "primary.md";
  const at = (name) => {
    const root = dir(`setup-upgrade-${name}`);
    assert.equal(odyssey(["apply"], { cwd: root }).status, 0, "no answers: the kit's rules, the slots, .gitignore");
    return [root, path.join(root, ".claude", "rules", "odyssey", RULE)];
  };
  const approve = (root) => odyssey(["apply", "--approve", `.claude/rules/odyssey/${RULE}`], { cwd: root });

  const [outdated, outdatedRule] = at("outdated");
  const older = "An older rule.\n";
  writeFileSync(outdatedRule, `<!-- odyssey-managed v0.9.0 sha256:${sha256(older)} -->\n${older}`);
  assert.match(odyssey(["plan"], { cwd: outdated }).stdout, /replace +\.claude\/rules\/odyssey\/primary\.md +\(untouched, stamped v0\.9\.0/);
  assert.equal(odyssey(["apply"], { cwd: outdated }).status, 0);
  assert.equal(readFileSync(outdatedRule, "utf8"), stampedCopy(RULE), "untouched and out of date: replaced");

  const [edited, editedRule] = at("edited");
  writeFileSync(editedRule, `${readFileSync(editedRule, "utf8")}\nOur own line.\n`);
  assert.match(odyssey(["plan"], { cwd: edited }).stdout, /\+\+\+ b\/kit\/primary\.md\n[\s\S]*^-Our own line\.$/m, "the diff shows what --approve would drop");
  assert.equal(odyssey(["apply"], { cwd: edited }).status, 0);
  assert.match(readFileSync(editedRule, "utf8"), /Our own line\./, "edited: kept");
  assert.equal(approve(edited).status, 0);
  assert.equal(readFileSync(editedRule, "utf8"), stampedCopy(RULE), "edited and approved: replaced");

  const [unstamped, unstampedRule] = at("unstamped");
  writeFileSync(unstampedRule, "Our scope rules.\n");
  assert.equal(odyssey(["apply"], { cwd: unstamped }).status, 0);
  assert.equal(readFileSync(unstampedRule, "utf8"), "Our scope rules.\n", "stamp removed: left alone");
  assert.equal(approve(unstamped).status, 1, "a file without its stamp is the user's, so it takes no approval");
  assert.equal(readFileSync(unstampedRule, "utf8"), "Our scope rules.\n");

  const [deleted, deletedRule] = at("deleted");
  rmSync(deletedRule);
  assert.equal(odyssey(["apply"], { cwd: deleted }).status, 0);
  assert.equal(existsSync(deletedRule), false, "deleted: offered back, not forced");
  assert.equal(approve(deleted).status, 0);
  assert.equal(readFileSync(deletedRule, "utf8"), stampedCopy(RULE), "deleted and approved: restored");
});

test("a re-run removes the rule files earlier versions installed when untouched, and keeps edited or unstamped ones", () => {
  const root = dir("setup-retired");
  assert.equal(odyssey(["apply"], { cwd: root }).status, 0);
  const rule = (name) => path.join(root, ".claude", "rules", "odyssey", name);
  const old = "An old kit rule.\n";
  const stamp = (text) => `<!-- odyssey-managed v0.9.0 sha256:${sha256(text)} -->\n`;
  writeFileSync(rule("git_approval_workflow.md"), stamp(old) + old);
  writeFileSync(rule("scope_containment.md"), stamp(old) + old + "Our own line.\n");
  writeFileSync(rule("production_design_only.md"), "Our production rule.\n");
  const planned = odyssey(["plan"], { cwd: root });
  assert.match(planned.stdout, /remove +\.claude\/rules\/odyssey\/git_approval_workflow\.md +\(retired by the kit, and untouched\)/);
  assert.equal(existsSync(rule("git_approval_workflow.md")), true, "plan writes nothing");
  const applied = odyssey(["apply"], { cwd: root });
  assert.equal(applied.status, 0);
  assert.match(applied.stdout, /removed +\.claude\/rules\/odyssey\/git_approval_workflow\.md/);
  assert.equal(existsSync(rule("git_approval_workflow.md")), false, "untouched: removed");
  assert.match(readFileSync(rule("scope_containment.md"), "utf8"), /Our own line\./, "edited: kept");
  assert.equal(readFileSync(rule("production_design_only.md"), "utf8"), "Our production rule.\n", "unstamped: kept");
  assert.match(applied.stdout, /kept +\.claude\/rules\/odyssey\/scope_containment\.md +\(retired by the kit, but yours now/);
});

test("a re-run removes a work-order folder holding only its placeholder, keeps one holding more, and drops the retired config keys", () => {
  const placeholder = "<!-- Empty: Layer 2 populates this with the active work order. -->\n";
  const empty = dir("setup-orders-empty");
  files(empty, { "directives/layer_3_work_orders/current.md": placeholder });
  const planned = odyssey(["plan"], { cwd: empty });
  assert.match(planned.stdout, /remove +directives\/layer_3_work_orders\/ +\(retired by the kit, and holds only its placeholder\)/);
  assert.equal(existsSync(path.join(empty, "directives", "layer_3_work_orders")), true, "plan writes nothing");
  assert.equal(odyssey(["apply"], { cwd: empty }).status, 0);
  assert.equal(existsSync(path.join(empty, "directives", "layer_3_work_orders")), false, "placeholder only: removed");
  const used = dir("setup-orders-used");
  const kept = { "directives/layer_3_work_orders/current.md": placeholder, "directives/layer_3_work_orders/WO-1.executed.md": "an order\n" };
  files(used, kept);
  files(used, { ".claude/odyssey.json": `${JSON.stringify({ version: 1, srcDirs: ["lib"], reviewers: ["odyssey:x"], layer2Owned: ["a.md"] }, null, 2)}\n` });
  const applied = odyssey(["apply"], { cwd: used });
  assert.equal(applied.status, 0);
  assert.match(applied.stdout, /kept +directives\/layer_3_work_orders\/ +\(retired by the kit, but it holds work orders or your files/);
  for (const [f, text] of Object.entries(kept)) assert.equal(readFileSync(path.join(used, f), "utf8"), text, f);
  assert.match(applied.stdout, /replaced +\.claude\/odyssey\.json +\(reviewers and layer2Owned retired by the kit, so removed/);
  assert.deepEqual(JSON.parse(readFileSync(path.join(used, ".claude", "odyssey.json"), "utf8")), { version: 1, srcDirs: ["lib"] });
  assert.match(odyssey(["apply"], { cwd: used }).stdout, /kept +\.claude\/odyssey\.json +\(exists: setup never changes it\)/);
});

test("a kit rule whose first line only mentions the stamp is the user's, not an edited kit file", () => {
  const root = dir("setup-mention");
  assert.equal(odyssey(["apply"], { cwd: root }).status, 0);
  const rule = path.join(root, ".claude", "rules", "odyssey", "primary.md");
  const ours = "# How the odyssey-managed stamp works\nOur own rules.\n";
  writeFileSync(rule, ours);
  assert.match(odyssey(["status"], { cwd: root }).stdout, /^ {2}\.claude\/rules\/odyssey\/primary\.md: its stamp line is removed, so it is yours$/m);
  assert.match(odyssey(["plan"], { cwd: root }).stdout, /keep +\.claude\/rules\/odyssey\/primary\.md +\(its stamp line is removed, so it is yours\)/);
  assert.equal(odyssey(["apply"], { cwd: root }).status, 0);
  assert.equal(readFileSync(rule, "utf8"), ours, "a re-run leaves it as it is");
});

test("Node below 22 stops setup, and doctor reports it", () => {
  const root = dir("setup-old-node");
  const preload = path.join(scratch, "node-20.mjs");
  writeFileSync(preload, 'Object.defineProperty(process, "versions", { value: { ...process.versions, node: "20.18.0" } });\n');
  const node = ["--import", pathToFileURL(preload).href];
  for (const command of ["plan", "apply"]) {
    const result = odyssey([command], { cwd: root, node });
    assert.equal(result.status, 1, command);
    assert.match(result.stderr, /needs Node\.js 22 or later, and this is 20\.18\.0/, command);
  }
  assert.deepEqual(readdirSync(root), [".git"], "nothing is written");
  const doctor = odyssey(["doctor"], { cwd: root, node });
  assert.equal(doctor.status, 1);
  assert.match(doctor.stdout, /^FAIL Odyssey needs Node\.js 22 or later/m);
});

test("the config and the project rules are rendered from the answers", () => {
  const root = dir("setup-rendered");
  assert.equal(odyssey(["apply", "--answers", answers("rendered", ANSWERS)], { cwd: root }).status, 0);
  const found = resolved({ cwd: root });
  assert.equal(found.notice, null, "the written config is valid");
  assert.deepEqual(found.config, { $schema: SCHEMA_ID, version: 1, ...ANSWERS.config });
  const rule = (name) => readFileSync(path.join(root, ".claude", "rules", name), "utf8");
  assert.match(rule("hot-path.md"), /^---\npaths:\n {2}- "src\/checkout\/\*\*\/\*\.ts"\n---\n/);
  assert.match(rule("hot-path.md"), /^- No await before the charge call\.$/m);
  assert.match(rule("sensitive-data.md"), /## End-user identifiers\n\n- email\n\n## Free-text content\n\n- None named\.\n/);
  assert.match(rule("sensitive-data.md"), /## Credentials\n\nWhere they live, as file names and variable names, never a value:\n\n- \.env\n- ~\/\.zshenv\n/);
  assert.match(rule("sensitive-data.md"), /grep -c '\^NAME=' <file>/, "how to read one without printing it");
  assert.equal(existsSync(path.join(root, ".claude", "rules", "project.md")), false, "CLAUDE.md is the user's place");

  const unnamed = dir("setup-credentials-only");
  odyssey(["apply", "--answers", answers("credentials-only", { sensitiveData: { identifiers: [], credentials: [".env"] } })], { cwd: unnamed });
  const credentials = readFileSync(path.join(unnamed, ".claude", "rules", "sensitive-data.md"), "utf8");
  assert.equal(credentials.split("- None named.").length - 1, 3, "one named item writes the rule, with the three logging lists");
  // It loads in every session of most repos setup fits.
  assert.ok(Buffer.byteLength(credentials) <= 850, `sensitive-data.md with one credential named is ${Buffer.byteLength(credentials)} bytes`);

  const bare = dir("setup-bare");
  const applied = odyssey(["apply", "--answers", answers("bare", { config: {}, sensitiveData: { identifiers: [] } })], { cwd: bare });
  assert.match(applied.stdout, /skipped +\.claude\/rules\/sensitive-data\.md +\(nothing sensitive named\)/);
  assert.equal(existsSync(path.join(bare, ".claude", "rules", "sensitive-data.md")), false);
  assert.match(applied.stdout, /skipped +\.claude\/rules\/hot-path\.md +\(no hot path named\)/);
  assert.deepEqual(JSON.parse(readFileSync(path.join(bare, ".claude", "odyssey.json"), "utf8")), { $schema: SCHEMA_ID, version: 1 });
  const invalid = odyssey(["plan", "--answers", answers("invalid", { config: { hooks: { typo: true } } })], { cwd: bare });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /hooks: unknown key "typo"/);
});

test("apply names each command that waits for trust, and the approve command the user runs", () => {
  const applied = odyssey(["apply", "--answers", answers("trust", ANSWERS)], { cwd: dir("setup-trust") });
  assert.match(applied.stdout, /stay off until you trust them:\n {2}npx tsc --noEmit\n/);
  assert.ok(applied.stdout.includes(`\n  node "${SCRIPT}" trust approve\n`), "in full, with the script's absolute path");
  const quiet = odyssey(["apply", "--answers", answers("no-trust", { config: {} })], { cwd: dir("setup-no-trust") });
  assert.doesNotMatch(quiet.stdout, /trust approve/, "nothing to trust, nothing printed");
});

test("status reports the hooks on here, their trust, the config version, the kit-owned rules and leftover wiring", () => {
  const root = dir("setup-status");
  assert.equal(odyssey(["apply", "--answers", answers("status", ANSWERS)], { cwd: root }).status, 0);
  writeFileSync(path.join(root, ".claude", "rules", "odyssey", "primary.md"), "Our own line.\n", { flag: "a" });
  const own = { type: "command", command: "node scripts/own-hook.mjs" };
  const copied = { type: "command", command: "node .claude/hooks/protect-env.mjs" };
  const settings = { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [copied, own] }] } };
  writeFileSync(path.join(root, ".claude", "settings.json"), JSON.stringify(settings));
  const status = odyssey(["status"], { cwd: root });
  assert.equal(status.status, 0);
  assert.match(status.stdout, /^Config: \.claude\/odyssey\.json, version 1\.$/m);
  assert.match(status.stdout, /always; from the config, protectManifest, typecheckGate\.$/m);
  assert.match(status.stdout, /^Not trusted, so it does not run: npx tsc --noEmit\./m);
  assert.match(status.stdout, /^Kit-owned rules: 0 of 1 up to date\.\n {2}\.claude\/rules\/odyssey\/primary\.md: edited since setup$/m);
  assert.match(status.stdout, /still wires 1 copied-kit hook, [^\n]*\n {2}PreToolUse Bash: node \.claude\/hooks\/protect-env\.mjs$/m);
  assert.equal(odyssey(["trust", "approve"], { cwd: root }).status, 0);
  assert.match(odyssey(["status"], { cwd: root }).stdout, /^Trusted: npx tsc --noEmit$/m);
  assert.equal(odyssey(["trust", "revoke"], { cwd: root }).status, 0);
});

test("doctor runs a canary for each switched-on guard, and each one blocks", () => {
  const config = { version: 1, hooks: { protectManifest: true, protectAppendOnly: true }, protect: { readOnly: ["audit-log.md"] } };
  const result = odyssey(["doctor"], { cwd: dir("doctor-on", { config }) });
  assert.equal(result.status, 0, result.stdout);
  for (const line of [
    `PASS Node ${process.versions.node}: 22 or later`,
    "PASS .claude/odyssey.json is valid against the bundled schema",
    "PASS no settings file turns the hooks off",
    "PASS protect-env blocks a Write to .env",
    "PASS protect-env blocks echo x > .env in Bash",
    "PASS protect-env blocks an MCP write_file to .env",
    "PASS protect-managed blocks an Edit to a stamped file",
    "PASS bash-guard blocks a zsh (P) expansion in Bash",
    "PASS protect-manifest blocks a Write to package.json",
    "PASS protect-append-only blocks a Write to audit-log.md",
  ]) {
    assert.ok(result.stdout.includes(`${line}\n`), line);
  }
  assert.match(result.stdout, /^doctor: 10 PASS, 0 FAIL$/m);
  const defaults = odyssey(["doctor"], { cwd: dir("doctor-defaults") });
  assert.match(defaults.stdout, /^doctor: 8 PASS, 0 FAIL$/m, "no config: the three guards that are always on");
});

test("doctor tests the manifest the config names", () => {
  const config = { version: 1, hooks: { protectManifest: true }, protect: { manifests: ["pyproject.toml"] } };
  const result = odyssey(["doctor"], { cwd: dir("doctor-manifest", { config }) });
  assert.equal(result.status, 0, result.stdout);
  assert.ok(result.stdout.includes("PASS protect-manifest blocks a Write to pyproject.toml\n"), result.stdout);
  assert.doesNotMatch(result.stdout, /a Write to package\.json/, "the repo's own manifest, not npm's");
  assert.match(result.stdout, /^doctor: 9 PASS, 0 FAIL$/m);
});

test("doctor fails when a guard is turned off, unwired or broken", () => {
  const off = dir("doctor-off");
  mkdirSync(path.join(off, ".claude"));
  writeFileSync(path.join(off, ".claude", "settings.json"), '{ "disableAllHooks": true }\n');
  const disabled = odyssey(["doctor"], { cwd: off });
  assert.equal(disabled.status, 1);
  assert.match(disabled.stdout, /^FAIL disableAllHooks is on in \S+settings\.json, so no hook runs$/m);

  // A copy of the plugin whose protect-env lets everything through and whose hooks.json
  // no longer wires protect-manifest.
  const copy = path.join(scratch, "plugin-copy");
  cpSync(PLUGIN, copy, { recursive: true });
  writeFileSync(path.join(copy, "hooks", "protect-env.mjs"), "process.exit(0);\n");
  const wiring = JSON.parse(readFileSync(path.join(copy, "hooks", "hooks.json"), "utf8"));
  const edits = wiring.hooks.PreToolUse[0];
  edits.hooks = edits.hooks.filter((hook) => !hook.args[0].endsWith("/protect-manifest.mjs"));
  writeFileSync(path.join(copy, "hooks", "hooks.json"), JSON.stringify(wiring));
  const root = dir("doctor-broken", { config: { version: 1, hooks: { protectManifest: true } } });
  const broken = odyssey(["doctor"], { cwd: root, script: path.join(copy, "scripts", "odyssey.mjs") });
  assert.equal(broken.status, 1);
  assert.match(broken.stdout, /^FAIL protect-env did not block a Write to \.env \(exit 0\)$/m);
  assert.match(broken.stdout, /^FAIL protect-manifest is not wired for Write in hooks\/hooks\.json/m);
  assert.match(broken.stdout, /^PASS protect-managed blocks an Edit to a stamped file$/m, "a working guard still passes");
});

test("doctor fails a hook that is switched on with nothing to act on", () => {
  const config = {
    version: 1,
    srcDirs: ["/src", "src/**", "SRC", "src", "./src/"],
    testDirs: ["tests", "../doctor-outside"],
    hooks: { typecheckGate: { enabled: true }, formatOnEdit: true },
  };
  const root = dir("doctor-idle", { config });
  mkdirSync(path.join(root, "src"));
  mkdirSync(path.join(scratch, "doctor-outside"));
  const result = odyssey(["doctor"], { cwd: root });
  assert.equal(result.status, 1, result.stdout);
  const failed = result.stdout.split("\n").filter((line) => line.startsWith("FAIL "));
  for (const line of [
    "FAIL hooks.typecheckGate is on, but it names no command, so the typecheck gate never runs",
    'FAIL srcDirs names "/src", which is not a path from the repo root, so no file matches it',
    'FAIL srcDirs names "src/**", which is no folder in the repo, so no file matches it',
    'FAIL testDirs names "tests", which is no folder in the repo, so no file matches it',
    'FAIL testDirs names "../doctor-outside", which leads outside the repo, so no file matches it',
  ]) {
    assert.ok(failed.includes(line), line);
  }
  // SRC is src/ spelled another way where letter case doesn't count, and no folder where it does.
  assert.ok(failed.some((line) => line.startsWith('FAIL srcDirs names "SRC", which ')), "SRC");
  assert.ok(failed.some((line) => line.startsWith("FAIL hooks.formatOnEdit is on, but ")), "no Prettier");
  assert.ok(failed.some((line) => line.startsWith("FAIL not trusted, so it does not run: ")), "the formatter isn't trusted");
  assert.equal(failed.length, 8, "src and ./src/ pass");
});

test("doctor passes a gate that names its command, folders that exist and a workspace's Prettier", () => {
  const top = dir("doctor-workspace");
  const root = path.join(top, "packages", "app");
  for (const folder of ["src", "test", ".claude"]) mkdirSync(path.join(root, folder), { recursive: true });
  const config = {
    version: 1,
    srcDirs: ["src", "./src/"],
    testDirs: ["test"],
    hooks: { typecheckGate: { enabled: true, command: "npx tsc --noEmit" }, formatOnEdit: true },
  };
  writeFileSync(path.join(root, ".claude", "odyssey.json"), JSON.stringify(config));
  const prettier = path.join(top, "node_modules", "prettier", "bin", "prettier.cjs");
  mkdirSync(path.dirname(prettier), { recursive: true });
  writeFileSync(prettier, "");
  assert.equal(odyssey(["trust", "approve"], { cwd: root }).status, 0);
  const result = odyssey(["doctor"], { cwd: root });
  assert.equal(result.status, 0, result.stdout);
  for (const line of [
    "PASS the typecheck gate is on and names its command",
    "PASS each srcDirs and testDirs entry is a folder in the repo",
    "PASS formatOnEdit finds Prettier at ../../node_modules/prettier/bin/prettier.cjs",
  ]) {
    assert.ok(result.stdout.includes(`${line}\n`), line);
  }
  assert.match(result.stdout, /^doctor: 12 PASS, 0 FAIL$/m);
});

test("doctor fails each command a switched-on hook runs that isn't trusted, and names the approve command", () => {
  const root = dir("doctor-untrusted", { config: { version: 1, gate: { stages: [{ name: "test", command: "make test" }] } } });
  const before = odyssey(["doctor"], { cwd: root });
  assert.equal(before.status, 1, before.stdout);
  assert.match(before.stdout, /^FAIL not trusted, so it does not run: make test\. Run this yourself in .+: node ".+odyssey\.mjs" trust approve$/m);
  assert.equal(odyssey(["trust", "approve"], { cwd: root }).status, 0);
  const after = odyssey(["doctor"], { cwd: root });
  assert.equal(after.status, 0, after.stdout);
  assert.match(after.stdout, /^PASS each command the switched-on hooks run is trusted$/m);
  assert.match(skillText("setup"), /then end with\s+the `Hooks on:` and trust lines that\s+`node <this skill's base directory>\/\.\.\/\.\.\/scripts\/odyssey\.mjs status` prints/);
});

// --- docs check -------------------------------------------------------------------------

const gitInit = (root) => spawnSync("git", ["init", "-q"], { cwd: root });
const FALLBACK = "AGENTS.md"; // the project's instruction file is `CLAUDE.md`, or `AGENTS.md` when the repo has no `CLAUDE.md`
function files(root, all) {
  for (const [name, text] of Object.entries(all)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), text);
  }
}

test("docs check passes a repo whose instruction files tell the truth, and skips what it cannot judge", () => {
  const root = dir("docs-clean", { config: { version: 1, srcDirs: ["app"] } });
  gitInit(root);
  files(root, {
    "app/main.py": "",
    "docs/guide.md": "# guide\n",
    ".gitignore": "dist/\nbundle.js\n",
    // A kit-owned rule describes the kit, not the repo: its `.coderabbit.yaml` is not a claim here.
    ".claude/rules/odyssey/primary.md": `<!-- odyssey-managed v${VERSION} sha256:${"0".repeat(64)} -->\nThe review config is \`.coderabbit.yaml\`.\n`,
    ".claude/rules/project.md": [
      "Present: `app/main.py`, `main.py`, [the guide](docs/guide.md), `docs/` and `app/main.py:12`.",
      "Built: `dist/` and `bundle.js`.",
      "Not paths: `https://x.test/a.md`, `/abs/x.py`, `~/.zshenv`, `$HOME/x.md`, `--flag`, `src/**/*.py`,",
      "`docs/<name>.md`, `feat/foo-0924`, `owner/repo`, `.py`, `config.value`, `npm run lint`, `.env`.",
      "```",
      "`gone/file.py`",
      "```",
      "",
    ].join("\n"),
    "CLAUDE.md": "The code is under `app/`.\n",
    // With a CLAUDE.md present, Claude Code never loads the fallback file; its claims are checked all the same.
    [FALLBACK]: "The code is under `app/`.\n",
  });
  const result = odyssey(["docs", "check"], { cwd: root });
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /^Docs check in .*: 3 files checked\.$/m, "CLAUDE.md, project.md and the fallback file; the stamped rule is left out");
  assert.ok(result.stdout.includes("\n.claude/rules/odyssey/primary.md: loads at start; a kit rule, so its claims are not checked\n"), result.stdout);
  assert.match(result.stdout, /^== paths ==\n\.claude\/rules\/project\.md:2 warning: `dist\/` does not exist here; git ignores it, so a build may create it\n\.claude\/rules\/project\.md:2 warning: `bundle\.js` does not exist here; git ignores it, so a build may create it\n== scripts ==/m);
  assert.match(result.stdout, /^info: no package\.json here; the scripts check is skipped$/m);
  assert.match(result.stdout, /^== ADR citations ==\nok$/m);
  assert.match(result.stdout, /^docs check: 0 error\(s\), 2 warning\(s\)$/m);
  assert.doesNotMatch(result.stdout, /gone\/file\.py|coderabbit/, "fenced code and the kit's rule are not claims");
});

test("docs check reads a rule whose first line only mentions the stamp, as the repo's own", () => {
  const root = dir("docs-mention");
  gitInit(root);
  files(root, { ".claude/rules/notes.md": "# How the odyssey-managed stamp works\nSee `gone/stamp.md`.\n" });
  const result = odyssey(["docs", "check"], { cwd: root });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /^\.claude\/rules\/notes\.md:2 error: `gone\/stamp\.md` does not exist/m);
});

test("a report longer than a pipe holds arrives whole, with its summary line", () => {
  // A pipe holds 64 KB at a time: an exit straight after the write lost the rest on macOS.
  const root = dir("docs-long");
  gitInit(root);
  const names = Array.from({ length: 1000 }, (_, i) => `\`gone/file-${String(i).padStart(4, "0")}.md\``);
  files(root, { "CLAUDE.md": `${names.join("\n")}\n` });
  const result = odyssey(["docs", "check"], { cwd: root });
  assert.equal(result.status, 1);
  assert.ok(result.stdout.length > 65536, `${result.stdout.length} bytes`);
  assert.match(result.stdout, /^docs check: 1000 error\(s\), 0 warning\(s\)$/m);
});

test("docs check flags a missing path, a script package.json lacks, an ADR docs/adr/ does not hold, and a shadowed skill", () => {
  const root = dir("docs-stale");
  gitInit(root);
  files(root, {
    "package.json": JSON.stringify({ scripts: { test: "node --test", lint: "eslint ." } }),
    "src/index.ts": "",
    "docs/adr/0001-a.md": "",
    "docs/adr/0002-b.md": "",
    "docs/adr/0003-c.md": "",
    ".claude/skills/deploy/SKILL.md": "repo copy\n",
    ".claude/agents/reviewer.md": "agent\n",
    // No CLAUDE.md here, so the fallback file is the instruction file Claude Code loads.
    [FALLBACK]: "Start at `src/main.ts`.\n",
    "README.md": [
      "Run `npm run lint`, `npm test` and `npm run gone`.",
      "See `src/index.ts`, `src/old.ts`, `helper.ts` and [the plan](docs/plan.md).",
      "ADR 0001 holds; ADR 0009 does not; ADRs 0001–0002 are not all of them; ADRs 0002–0008 end past the last.",
      "",
    ].join("\n"),
  });
  files(home, { ".claude/skills/deploy/SKILL.md": "personal copy\n", ".claude/agents/reviewer.md": "agent\n" });
  const result = odyssey(["docs", "check"], { cwd: root });
  rmSync(path.join(home, ".claude", "skills"), { recursive: true });
  rmSync(path.join(home, ".claude", "agents"), { recursive: true });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^Docs check in .*: 4 files checked\.$/m);
  for (const line of [
    `${FALLBACK}:1 error: \`src/main.ts\` does not exist (resolved from the repo root and from the root)`,
    "README.md:2 error: `src/old.ts` does not exist (resolved from the repo root and from the root)",
    "README.md:2 error: `helper.ts` does not exist (no file of that name under src/, test/, tests/, scripts/, docs/, directives/, .claude/, .github/)",
    "README.md:2 error: `docs/plan.md` does not exist (resolved from the repo root and from the root)",
    'README.md:1 error: `npm run gone` names no package.json script "gone"',
    "README.md:3 error: ADR 0009 cites an ADR that docs/adr/ does not hold (it runs 0001–0003)",
    "README.md:3 error: range 0001–0002 stops short: docs/adr/ runs to 0003",
    "README.md:3 error: range 0002–0008 ends at an ADR that docs/adr/ does not hold",
    ".claude/skills/deploy/SKILL.md warning: shadowed by ~/.claude/skills/deploy/SKILL.md (contents differ): a personal skill loads instead of a project skill of the same name, so this copy never runs",
    ".claude/agents/reviewer.md info: ~/.claude/agents/reviewer.md shares the name; the project copy wins",
    "docs check: 8 error(s), 1 warning(s)",
  ]) {
    assert.ok(result.stdout.includes(`${line}\n`), `${line}\n---\n${result.stdout}`);
  }
  assert.doesNotMatch(result.stdout, /npm run lint|npm test|src\/index\.ts|ADR 0001 /, "true claims pass");
});

test("docs check reads a GLOSSARY.md as it reads a CONTEXT.md, so a repo on either name is checked", () => {
  const root = dir("docs-glossary");
  gitInit(root);
  files(root, {
    "src/order.ts": "",
    "CONTEXT.md": "An order lives in `src/order.ts`, a cart in `src/cart.ts`.\n",
    "GLOSSARY.md": "**Order**: see `src/order.ts`. **Refund**: see `src/refund.ts`.\n",
  });
  const result = odyssey(["docs", "check"], { cwd: root });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /^Docs check in .*: 2 files checked\.$/m);
  for (const line of [
    "CONTEXT.md:1 error: `src/cart.ts` does not exist (resolved from the repo root and from the root)",
    "GLOSSARY.md:1 error: `src/refund.ts` does not exist (resolved from the repo root and from the root)",
    "docs check: 2 error(s), 0 warning(s)",
  ]) {
    assert.ok(result.stdout.includes(`${line}\n`), `${line}\n---\n${result.stdout}`);
  }
});

// The load log's file for a repo, as the hook and the docs check name it.
const loadLog = (root) =>
  path.join(home, ".claude", "odyssey-loads", `${createHash("sha256").update(root).digest("hex").slice(0, 16)}.jsonl`);
const NEVER = "never loads: Claude Code reads it only where no `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` stands in its folder or above it";

test("docs check lists every instruction file with when it loads, found without git, and the files outside the repo", () => {
  const root = dir("docs-walk");
  gitInit(root);
  files(root, {
    ".gitignore": "CLAUDE.local.md\n",
    "CLAUDE.md": "# Project\nRead @docs/a.md first.\nAsk @reviewer before a release.\n",
    "CLAUDE.local.md": "Local notes.\n",
    // Beside a CLAUDE.md the fallback file never loads; its claims are checked all the same.
    [FALLBACK]: "Run `scripts/gone.sh`.\n",
    ".claude/rules/api.md": '---\npaths:\n  - "src/api/**"\n---\nAPI rules.\n',
    ".claude/rules/style.md": "Style rules.\n",
    "web/CLAUDE.md": "Web notes.\n",
    "web/.claude/rules/web.md": "Web rules.\n",
    "docs/a.md": "@b.md\n",
    "docs/b.md": "@c.md\n",
    "docs/c.md": "@d.md\n",
    "docs/d.md": "@e.md\n",
    "docs/e.md": "Past the chain.\n",
    "node_modules/pkg/CLAUDE.md": "A package's own notes.\n",
    ".venv/lib/pkg/CLAUDE.md": "Another package's own notes.\n",
  });
  files(home, { ".claude/CLAUDE.md": "Mine.\n", ".claude/rules/mine.md": '---\npaths: "**/*.py"\n---\nPython.\n' });
  const result = odyssey(["docs", "check"], { cwd: root });
  rmSync(path.join(home, ".claude", "CLAUDE.md"));
  rmSync(path.join(home, ".claude", "rules"), { recursive: true });
  assert.equal(result.status, 1, result.stdout);
  const report = [
    "== instruction files ==",
    "CLAUDE.md: loads at start",
    "CLAUDE.local.md: loads at start",
    `${FALLBACK}: ${NEVER}`,
    ".claude/rules/api.md: loads when Claude reads a file matching src/api/**",
    ".claude/rules/style.md: loads at start",
    "web/CLAUDE.md: loads when Claude reads a file under web/",
    "web/.claude/rules/web.md: loads when Claude reads a file under web/",
    "docs/a.md: loads at start, imported at CLAUDE.md:2",
    "docs/b.md: loads at start, imported at docs/a.md:1",
    "docs/c.md: loads at start, imported at docs/b.md:1",
    "docs/d.md: loads at start, imported at docs/c.md:1",
    "docs/e.md: never loads: its import at docs/d.md:1 is past the 4 hops Claude Code follows",
    "== outside the repo, read for conflicts only ==",
    "~/.claude/CLAUDE.md: loads at start",
    "~/.claude/rules/mine.md: loads when Claude reads a file matching **/*.py",
    "== load log ==",
    "off: switch on hooks.loadLog in .claude/odyssey.json, and each session's loads are logged here",
    "== imports ==",
    "CLAUDE.md:3 warning: `@reviewer` names no file, so nothing is imported; wrap it in backticks if it is not meant as an import",
    "== paths ==",
    `${FALLBACK}:1 error: \`scripts/gone.sh\` does not exist (resolved from the repo root and from the root)`,
  ].join("\n");
  assert.ok(result.stdout.includes(`\n${report}\n`), result.stdout);
  assert.match(result.stdout, /^docs check: 1 error\(s\), 1 warning\(s\)$/m);
  assert.doesNotMatch(result.stdout, /node_modules|\.venv/, "a dependency folder is not walked");
});

test("docs check reads the fallback files as Claude Code does, and says the load log never sees them", () => {
  const root = dir("docs-fallback", { config: { version: 1, hooks: { loadLog: true } } });
  gitInit(root);
  files(root, {
    [FALLBACK]: "Root notes.\n",
    [`sub/${FALLBACK}`]: "Sub notes.\n",
    "other/CLAUDE.md": "Other notes.\n",
    [`other/${FALLBACK}`]: "Never read: other/ has a CLAUDE.md.\n",
  });
  mkdirSync(path.dirname(loadLog(root)), { recursive: true });
  writeFileSync(loadLog(root), `${JSON.stringify({ time: "2026-09-27T12:00:00.000Z", session: "s1", file: path.join(root, "other", "CLAUDE.md"), reason: "nested_traversal" })}\n`);
  const result = odyssey(["docs", "check"], { cwd: root });
  assert.equal(result.status, 0, result.stdout);
  const report = [
    "== instruction files ==",
    `${FALLBACK}: loads at start`,
    "other/CLAUDE.md: loads when Claude reads a file under other/",
    `other/${FALLBACK}: ${NEVER}`,
    `sub/${FALLBACK}: loads when Claude reads a file under sub/`,
    "== outside the repo, read for conflicts only ==",
    "none",
    "== load log ==",
    "1 session logged, the last at 2026-09-27T12:00:00.000Z",
    `${FALLBACK}: loaded in 0 of 1; Claude Code sends no load event for this file`,
    "other/CLAUDE.md: loaded in 1 of 1",
    `other/${FALLBACK}: loaded in 0 of 1`,
    `sub/${FALLBACK}: loaded in 0 of 1; Claude Code sends no load event for this file`,
    "== imports ==",
    "ok",
  ].join("\n");
  assert.ok(result.stdout.includes(`\n${report}\n`), result.stdout);
});

test("docs check counts the logged sessions that loaded each file, and names a logged file on neither list", () => {
  const root = dir("docs-log", { config: { version: 1, hooks: { loadLog: true } } });
  gitInit(root);
  files(root, { "CLAUDE.md": "Notes.\n", ".claude/rules/api.md": '---\npaths: "src/api/**"\n---\nAPI.\n', "extra/NOTES.md": "x\n" });
  const before = odyssey(["docs", "check"], { cwd: root });
  assert.ok(before.stdout.includes("\n== load log ==\nno session is logged here yet\n"), before.stdout);
  const line = (session, file, time) => JSON.stringify({ time, session, file, reason: "session_start" });
  mkdirSync(path.dirname(loadLog(root)), { recursive: true });
  writeFileSync(
    loadLog(root),
    [
      line("s1", path.join(root, "CLAUDE.md"), "2026-09-27T12:00:00.000Z"),
      line("s2", path.join(root, "CLAUDE.md"), "2026-09-27T13:00:00.000Z"),
      line("s2", path.join(root, ".claude", "rules", "api.md"), "2026-09-27T13:01:00.000Z"),
      line("s2", path.join(root, "extra", "NOTES.md"), "2026-09-27T13:02:00.000Z"),
      line("s1", path.join(root, "CLAUDE.md"), "2026-09-27T12:59:00.000Z"),
      "not json",
      "",
    ].join("\n"),
  );
  const result = odyssey(["docs", "check"], { cwd: root });
  const report = [
    "== load log ==",
    "2 sessions logged, the last at 2026-09-27T13:02:00.000Z",
    "CLAUDE.md: loaded in 2 of 2",
    ".claude/rules/api.md: loaded in 1 of 2",
    "extra/NOTES.md: loaded in 1 of 2, and on neither list above",
    "== imports ==",
  ].join("\n");
  assert.ok(result.stdout.includes(`\n${report}\n`), result.stdout);
});

test("docs check says when git can't say whether it ignores a missing path", () => {
  const root = dir("docs-no-git");
  gitInit(root);
  files(root, { "README.md": "Built into `dist/`.\n" });
  // GIT_DIR pointing nowhere fails every git call, as a sandbox that keeps git from its config does.
  const result = spawnSync(process.execPath, [SCRIPT, "docs", "check"], {
    cwd: root,
    env: { ...env(root), GIT_DIR: path.join(scratch, "no-git-here") },
    encoding: "utf8",
  });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /^README\.md:1 error: `dist\/` does not exist, and git could not say whether it ignores it \(fatal: not a git repository: .*\)$/m);
});

test("docs check reports a file it can't read, and checks the rest", () => {
  const root = dir("docs-unreadable");
  gitInit(root);
  files(root, { ".claude/rules/style.md": "See `gone/style.md`.\n" });
  symlinkSync("moved.md", path.join(root, "CLAUDE.md")); // a link whose target is gone
  const result = odyssey(["docs", "check"], { cwd: root });
  assert.equal(result.status, 1, result.stdout);
  assert.ok(result.stdout.includes("\n== instruction files ==\nCLAUDE.md: never loads: it can't be read\n"), result.stdout);
  assert.match(result.stdout, /^\.claude\/rules\/style\.md:1 error: `gone\/style\.md` does not exist/m, "the rest of the check still runs");
  assert.match(result.stdout, /^== unreadable files ==\nCLAUDE\.md error: can't be read \(ENOENT\): Claude Code can't load it, and nothing in it is checked\ndocs check: 2 error\(s\), 0 warning\(s\)$/m);
});

test("every skill description reads whole", () => {
  // A plain YAML value ends at " #", where a comment starts, and breaks at ": ", which
  // starts a mapping, so a description holding either is quoted.
  const files = readdirSync(path.join(PLUGIN, "skills")).map((name) => path.join(PLUGIN, "skills", name, "SKILL.md"));
  assert.equal(files.length, 26, "26 skills");
  assert.equal(existsSync(path.join(PLUGIN, "agents")), false, "no agents");
  for (const file of files) {
    const line = readFileSync(file, "utf8").split(/\r?\n/).find((text) => text.startsWith("description:"));
    assert.ok(line, `${file} has a description`);
    const value = line.slice("description:".length).trim();
    if (value.startsWith('"')) assert.match(value, /^"(?:[^"\\]|\\.)*"$/, `${file}: the quotes close at the end of the line`);
    else assert.doesNotMatch(value, / #|: |^['>|]/, `${file}: quote a description that holds " #" or ": "`);
  }
});

test("every odyssey: name the kit's text uses is one of its skills", () => {
  const skills = new Set(readdirSync(path.join(PLUGIN, "skills")));
  const unknown = [];
  // CHANGELOG.md is history: it may name a skill the kit has since retired.
  for (const file of readdirSync(PLUGIN, { recursive: true }).filter((name) => name.endsWith(".md") && name !== "CHANGELOG.md")) {
    for (const [, name] of readFileSync(path.join(PLUGIN, file), "utf8").matchAll(/\bodyssey:([a-z][a-z-]*)/g)) {
      if (!skills.has(name)) unknown.push(`${file}: odyssey:${name}`);
    }
  }
  assert.deepEqual(unknown, []);
});

test("init is now setup, and nothing names the old command", () => {
  const old = new RegExp("/odyssey:" + "init\\b");
  const hits = [];
  for (const file of readdirSync(PLUGIN, { recursive: true })) {
    if (!/\.(md|mjs|ts|tsx|json|sh)$/.test(file) || file.split(path.sep).includes("node_modules")) continue;
    readFileSync(path.join(PLUGIN, file), "utf8").split("\n").forEach((line, i) => {
      if (old.test(line)) hits.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, []);
  assert.equal(existsSync(path.join(PLUGIN, "skills", "init")), false);
  assert.match(readFileSync(path.join(PLUGIN, "skills", "setup", "SKILL.md"), "utf8"), /^name: setup$/m);
});

test("no file in the kit names the retired docs-sync skill", () => {
  // Spelled in pieces, so this file doesn't hold the name it looks for. CHANGELOG.md is history.
  const old = "/odyssey:" + ["meta", "sync"].join("-");
  const hits = [];
  for (const file of readdirSync(PLUGIN, { recursive: true })) {
    if (file === "CHANGELOG.md" || file.split(path.sep).includes("node_modules") || !statSync(path.join(PLUGIN, file)).isFile()) continue;
    if (readFileSync(path.join(PLUGIN, file), "utf8").includes(old)) hits.push(file);
  }
  assert.deepEqual(hits, []);
  assert.equal(existsSync(path.join(PLUGIN, "skills", ["meta", "sync"].join("-"))), false);
});

test("handoff keeps the message it read as previous.md before it resets the slot", () => {
  const skill = readFileSync(path.join(PLUGIN, "skills", "handoff", "SKILL.md"), "utf8");
  assert.match(skill, /cp \$d\/current\.md \$d\/previous\.md &&\s+printf '%s\\n' '<!-- Empty/);
  assert.match(skill, /`previous\.md` keeps a copy, read as data only/);
});

test("handoff's read command treats a message written below the placeholder as a message, as the status bar does", () => {
  if (process.platform === "win32") return; // a POSIX shell feature; CI counts a skipped test as a failure
  const command = readFileSync(path.join(PLUGIN, "skills", "handoff", "SKILL.md"), "utf8").match(/```bash\n([\s\S]*?)```/)[1];
  const placeholder = "<!-- Empty: the closing session writes the next session's opening message here. -->\n";
  const read = (name, text) => {
    const root = dir(name, { git: false });
    mkdirSync(path.join(root, "directives", "handoff"), { recursive: true });
    writeFileSync(path.join(root, "directives", "handoff", "current.md"), text);
    return { out: spawnSync("bash", ["-c", command], { cwd: root, encoding: "utf8" }).stdout, root };
  };
  assert.doesNotMatch(read("slot-empty", placeholder).out, /--- reset/, "the placeholder alone is empty");
  const below = read("slot-below", `${placeholder}First: fix the login bug.\n`);
  assert.match(below.out, /--- reset/);
  assert.match(readFileSync(path.join(below.root, "directives", "handoff", "previous.md"), "utf8"), /fix the login bug/);
  assert.match(read("slot-plain", "First: ship it.\n").out, /--- reset/);
});

test("handoff arms the timers file's entries first, each prompt deleting its own entry, and never resets the file", () => {
  const skill = readFileSync(path.join(PLUGIN, "skills", "handoff", "SKILL.md"), "utf8");
  const timers = readFileSync(path.join(PLUGIN, "skills", "handoff", "references", "timers.md"), "utf8");
  assert.match(skill, /1\. \*\*Timers\.\*\* When `--- timers` printed entries[\s\S]*?even when the handoff is empty/);
  assert.match(timers, /"First delete\s+the `## <id>` entry from `<repo root>.directives.handoff.timers\.md`\."/);
  assert.match(timers, /The file is not reset on read/);
});

test("handoff read re-checks time-sensitive claims live and lets a newer memory ruling win", () => {
  const skill = readFileSync(path.join(PLUGIN, "skills", "handoff", "SKILL.md"), "utf8");
  assert.match(skill, /Re-check live only its\s+time-sensitive claims/);
  assert.match(skill, /conflicts\s+with a newer ruling in memory, follow the ruling and say so/);
  assert.doesNotMatch(skill, /as if the user had pasted it/);
});

test("the always-on rule stays near 1 KB, and the gate it no longer states runs as the commit hook with its docs stage", () => {
  const rule = readFileSync(path.join(PLUGIN, "scaffold", ".claude", "rules", "odyssey", "primary.md"), "utf8");
  const gate = readFileSync(path.join(PLUGIN, "skills", "local-gate", "gate.md"), "utf8");
  assert.ok(Buffer.byteLength(rule) <= 1100, `primary.md is ${Buffer.byteLength(rule)} bytes`);
  assert.match(rule, /name\s+the files it names, with their tests and any file the repo's own instructions require for\s+that change, and stay inside them/);
  assert.match(rule, /otherwise report it as found, not fixed/);
  assert.doesNotMatch(rule, /first of these that applies|zsh|heredoc|gate/);
  assert.match(gate, /the commit gate\s+\(`hooks\/bash-guard\.mjs`\) runs it before each `git commit`/);
  assert.match(gate, /\*\*The docs stage\*\* runs beside them in every mode/);
  assert.match(gate, /`node <this file's folder>\/\.\.\/\.\.\/scripts\/odyssey\.mjs docs check`/);
  assert.match(gate, /when the config names `docs\.check`/);
  assert.match(gate, /prints `0 files checked`\s+and the config names no `docs\.check`, the repo has no docs: skip the stage/);
});

test("cr-triage doesn't load for a plain request to fix a review's findings, and hands back a refused gh pr edit", () => {
  const skill = readFileSync(path.join(PLUGIN, "skills", "cr-triage", "SKILL.md"), "utf8");
  assert.match(skill.split("\n---")[0], /Not for a plain request to fix a review's findings\./);
  assert.match(skill, /If a permission check\s+refuses the `gh pr edit`/);
});

test("cr-triage's round is vetting then one fixer from the .resolved, and a rejection's reason goes in the thread, never the code", () => {
  const skill = readFileSync(path.join(PLUGIN, "skills", "cr-triage", "SKILL.md"), "utf8");
  assert.match(skill, /\*\*Fix\*\*: make the accepted changes directly, the `\.resolved` the whole spec/);
  assert.match(skill, /under the open-PR rule in\s+`\.claude\/rules\/odyssey\/primary\.md`'s Git rule/);
  assert.match(skill, /The reason goes in the `\.resolved` and in the thread reply\s+\(§1b\), never into the code\./);
  assert.doesNotMatch(skill, /work order/);
});

test("every skill built from Matt Pocock's names its source and has its Credits table", () => {
  const readme = readFileSync(path.join(PLUGIN, "README.md"), "utf8");
  const credits = readme.slice(readme.indexOf("### Built from Matt Pocock's skills"), readme.indexOf("\n## License"));
  const built = readdirSync(path.join(PLUGIN, "skills")).filter((name) =>
    /^Built from Matt Pocock's [^(]*\(mattpocock\/skills v1\.3\.1, MIT\)/m.test(readFileSync(path.join(PLUGIN, "skills", name, "SKILL.md"), "utf8")),
  );
  const tabled = [...credits.matchAll(/^\*\*`\/odyssey:([a-z-]+)`\*\*, from his /gm)].map((match) => match[1]);
  assert.deepEqual(built.sort(), tabled.sort());
  assert.ok(built.length > 0);
  for (const name of tabled) {
    const table = credits.slice(credits.indexOf(`**\`/odyssey:${name}\`**`)).split("\n\n")[1];
    assert.deepEqual(
      [...table.matchAll(/^\| (Included|Added|Removed|Evolved) \| [^|]+ \| [^|]+ \|$/gm)].map((match) => match[1]),
      ["Included", "Added", "Removed", "Evolved"],
      `${name}: one row each, with a what and a why`,
    );
  }
});

test("the README carries Matt Pocock's and Lauren Tan's MIT notices whole", () => {
  // The kit's own LICENSE is the same MIT text under another copyright line.
  const readme = readFileSync(path.join(PLUGIN, "README.md"), "utf8");
  const mit = readFileSync(path.join(PLUGIN, "LICENSE"), "utf8");
  const notices = [...readme.matchAll(/^```\n(MIT License\n[\s\S]*?)```$/gm)].map((match) => match[1]);
  const as = (holder) => mit.replace(/^Copyright \(c\) .*$/m, `Copyright (c) 2026 ${holder}`);
  assert.deepEqual(notices, [as("Matt Pocock"), as("Lauren Tan")]);
});

test("grill-me writes each answer before the next question and resumes from its record", () => {
  const skill = readFileSync(path.join(PLUGIN, "skills", "grill-me", "SKILL.md"), "utf8");
  assert.match(skill, /append one line to the record \*\*before\*\* asking anything else/);
  assert.match(skill, /^G<n> — <question>: <decision>\. Why: <reason>\.$/m);
  assert.match(skill, /^G<n> — <question>: OPEN, ask <who>\./m);
  assert.match(skill, /this is a resume\. Read them, count on from the last\s+number, never re-ask a settled line/);
  assert.match(skill, /^Grilling done <YYYY-MM-DD>: /m);
  assert.match(skill, /`docs\/grills\/<YYYY-MM-DD>-<slug>\.md`/);
});

test("a mage keeps secrets off the screen and out of its record, and a rerun skips a finished stage", () => {
  const root = dir("mage", { git: false });
  const slash = (file) => file.split(path.sep).join("/");
  const env = { ...process.env, MAGE_DIR: slash(path.join(root, "rec")), ENV_FILE: slash(path.join(root, "values.txt")), SSH_CONNECTION: "test" };
  const script = slash(path.join(PLUGIN, "skills", "mage", "template.sh"));
  const first = spawnSync("bash", [script], { cwd: root, env, input: "id-123\ns3cret-token\n", encoding: "utf8" });
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.doesNotMatch(first.stdout, /s3cret-token/);
  assert.match(first.stdout, /https:\/\/example\.com\/settings\/tokens/, "the link is printed");
  const record = readFileSync(path.join(root, "rec", "example-setup.record"), "utf8");
  assert.match(record, /^keys\tdone\t\S+\tExample: an ID and a token$/m);
  assert.doesNotMatch(record, /s3cret-token|id-123/);
  assert.match(readFileSync(path.join(root, "values.txt"), "utf8"), /^EXAMPLE_ID=id-123\nEXAMPLE_TOKEN=s3cret-token\n$/);
  const again = spawnSync("bash", [script], { cwd: root, env, input: "", encoding: "utf8" });
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.match(again.stdout, /Example: an ID and a token.*\(already done\)/);
  assert.doesNotMatch(again.stdout, /Paste the/, "no question asked again");
});

test("no skill built from his calls one of his skills by its own name", () => {
  const his = /Skill tool with|(?<![\w.-])\/(?:tdd|grilling|codebase-design|domain-modeling|diagnosing-bugs|code-review|improve-codebase-architecture|prototype|research|wait-what|writing-for-agents|wizard|setup-matt-pocock-skills)\b/;
  const hits = [];
  for (const file of readdirSync(path.join(PLUGIN, "skills"), { recursive: true }).filter((name) => name.endsWith(".md"))) {
    readFileSync(path.join(PLUGIN, "skills", file), "utf8").split("\n").forEach((line, i) => {
      if (his.test(line)) hits.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, []);
});

test("nothing points to Matt Pocock's pack, its setup skill or an issue tracker", () => {
  const hits = [];
  for (const file of readdirSync(PLUGIN, { recursive: true }).filter((name) => name.endsWith(".md"))) {
    readFileSync(path.join(PLUGIN, file), "utf8").split("\n").forEach((line, i) => {
      if (/mattpocock-skills|setup-matt-pocock-skills|issue tracker/i.test(line) && !/^\| Removed \|/.test(line)) hits.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, []);
});

// --- repo-state helpers -------------------------------------------------------------------

// A real git repo on main whose one commit holds `all`. -> { root, git, head }, head short.
function gitRepo(name, all) {
  const root = dir(name, { git: false });
  const git = (...args) =>
    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], {
      cwd: root,
      encoding: "utf8",
    });
  git("init", "-q", "-b", "main");
  files(root, all);
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  return { root, git, head: git("rev-parse", "HEAD").stdout.trim().slice(0, 7) };
}


// --- make-a-path and what-next: next and open -------------------------------------------

// A repo the kit is set up in, with a source file. -> gitRepo's { root, git, head }
const kitRepo = (name, extra = {}) => gitRepo(name, { ".claude/rules/odyssey/primary.md": "rules\n", "src/index.js": "export const a = 1;\n", ...extra });
const next = (root, ...flags) => JSON.parse(odyssey(["next", "--json", ...flags], { cwd: root }).stdout);
const commit = (repo, file, message) => {
  files(repo.root, { [file]: `${message}\n` });
  repo.git("add", "-A");
  repo.git("commit", "-q", "-m", message);
};
const PLAN = "docs/plans/2026-01-01-cart.md";
const REVIEW = "references/CR reviews/pr1-round1.md";

const fires = (root, rule, command, ...flags) => {
  const { next: fired } = next(root, ...flags);
  assert.deepEqual([fired.rule, fired.next], [rule, command]);
};
const ungrilled = "**Status:** ACTIVE — the cart\n\n# Cart\n";

test('next: the "setup missing" rule', () => fires(gitRepo("next-setup", { "a.txt": "a\n" }).root, "setup missing", "/odyssey:setup"));
test('next: the "handoff waiting" rule', () =>
  fires(kitRepo("next-handoff", { "directives/handoff/current.md": "Start with the cart.\n" }).root, "handoff waiting", "/odyssey:handoff"));
test('next: the "compacted session" rule', () => fires(kitRepo("next-compacted").root, "compacted session", "/odyssey:handoff write", "--compacted"));
test('next: the "findings untriaged" rule', () =>
  fires(kitRepo("next-untriaged", { [REVIEW]: "findings\n" }).root, "findings untriaged", `/odyssey:cr-triage ${REVIEW}`));
test("next: a triaged findings file opens nothing", () => {
  const resolved = "references/CR reviews/pr1-round1.resolved.md";
  fires(kitRepo("next-unauthored", { [REVIEW]: "findings\n", [resolved]: "1. Accepted.\n" }).root, "nothing open", "wait");
});
test('next: the "commits ahead, no PR" rule', () => {
  const repo = kitRepo("next-ahead");
  repo.git("checkout", "-q", "-b", "feature");
  commit(repo, "b.txt", "b");
  fires(repo.root, "commits ahead, no PR", "the pre-push CodeRabbit CLI review, then push and open a PR");
});
test('next: the "plan not grilled" rule', () => fires(kitRepo("next-ungrilled", { [PLAN]: ungrilled }).root, "plan not grilled", `/odyssey:grill-me ${PLAN}`));
test('next: the "plan grilled" rule', () =>
  fires(kitRepo("next-grilled", { [PLAN]: `${ungrilled}\nGrilling done 2026-01-02: 3 settled, 0 open.\n` }).root, "plan grilled", `the next slice of ${PLAN}`));
test('next: the "nothing open" rule', () =>
  fires(kitRepo("next-nothing", { "docs/plans/2025-12-01-old.md": "**Status:** CLOSED abc1234 — shipped\n" }).root, "nothing open", "wait"));

test("next: the first match wins, and Also holds the next two", () => {
  const root = kitRepo("next-order-of-rules", {
    "directives/handoff/current.md": "Start with the cart.\n",
    [REVIEW]: "findings\n",
    [PLAN]: "**Status:** ACTIVE — the cart\n",
  }).root;
  const result = next(root);
  assert.deepEqual([result.next.rule, ...result.also.map((also) => also.rule)], ["handoff waiting", "findings untriaged", "plan not grilled"]);
  assert.equal("orders" in result.here, false);
  const text = odyssey(["next"], { cwd: root }).stdout;
  assert.match(text, /^Here: on main, a clean tree, a handoff waiting\.\nNext: \/odyssey:handoff \(handoff waiting: /);
  assert.equal(text.split("\n").filter((line) => line.startsWith("Also: ")).length, 2);
});

test("next: an open pull request drops the commits-ahead rule", () => {
  const repo = kitRepo("next-pr-open");
  repo.git("checkout", "-q", "-b", "feature");
  commit(repo, "b.txt", "b");
  assert.equal(next(repo.root, "--pr-open").next.rule, "nothing open");
});

// open: one test per source, each thread as "kind | file | text".
const threads = (root) => JSON.parse(odyssey(["open", "--json"], { cwd: root }).stdout).threads.map((t) => `${t.kind} | ${t.file} | ${t.text}`);

test("open: uncommitted changes, leaving the kit's own files out", () => {
  const { root } = kitRepo("open-uncommitted");
  files(root, { "src/index.js": "export const a = 2;\n", "directives/handoff/current.md": "a note\n" });
  assert.deepEqual(threads(root), ["uncommitted | src/index.js | changed, not committed"]);
});

test("open: commits not on any remote", () => {
  const repo = kitRepo("open-unpushed");
  const remote = path.join(scratch, "open-unpushed.git");
  spawnSync("git", ["init", "-q", "--bare", remote]);
  repo.git("remote", "add", "origin", remote);
  repo.git("push", "-q", "-u", "origin", "main");
  commit(repo, "b.txt", "two");
  assert.equal(threads(repo.root).filter((t) => /^unpushed \| git \| [0-9a-f]+ two$/.test(t)).length, 1);
});

test("open: branches not merged into the default one", () => {
  const repo = kitRepo("open-unmerged");
  repo.git("checkout", "-q", "-b", "side");
  commit(repo, "b.txt", "b");
  repo.git("checkout", "-q", "main");
  assert.ok(threads(repo.root).includes("unmerged branch | git | side, not merged into main"));
});

test("open: active plans", () => {
  const { root } = kitRepo("open-plans", { [PLAN]: "**Status:** ACTIVE — the cart\n", "docs/plans/2025-12-01-old.md": "**Status:** CLOSED abc1234 — shipped\n" });
  assert.deepEqual(threads(root), [`active plan | ${PLAN} | ACTIVE, not grilled`]);
});

test("open: open grilling questions", () => {
  const record = "docs/grills/2026-01-01-cart.md";
  const { root } = kitRepo("open-grills", { [record]: "**Status:** GRILLING\n\nG1 — Who pays shipping?: OPEN, ask finance.\nG2 — Tax?: Included. Why: it's the law.\n" });
  assert.deepEqual(threads(root), [`open grilling question | ${record}:3 | G1 — Who pays shipping?: OPEN, ask finance.`]);
});

test("open: the last handoff's open flags written on the label's line", () => {
  const { root } = kitRepo("open-previous-inline", { "directives/handoff/previous.md": "**Open flags:** the name; the price.\n" });
  assert.deepEqual(threads(root), ["last handoff's open flag | directives/handoff/previous.md | the name; the price."]);
});

test("open: CodeRabbit findings a disposition deferred", () => {
  const resolved = "references/CR reviews/pr1-round1.resolved.md";
  const { root } = kitRepo("open-cr", { [REVIEW]: "findings\n", [resolved]: "1. Accepted: the null check.\n2. Deferred to Phase 2 — the cache can wait.\n" });
  assert.deepEqual(threads(root), [`deferred CR finding | ${resolved}:2 | 2. Deferred to Phase 2 — the cache can wait.`]);
});

test("open: the CHANGELOG's unreleased section, and nothing below it", () => {
  const { root } = kitRepo("open-changelog", { "CHANGELOG.md": "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Refunds.\n  More about refunds.\n\n## [1.0.0]\n\n- The cart.\n" });
  assert.deepEqual(threads(root), ["unreleased | CHANGELOG.md | Refunds."]);
});

test("open: the last handoff's open flags, and where you left off", () => {
  const { root } = kitRepo("open-previous", { "directives/handoff/previous.md": "**Later:**\n- publish\n\n**Open flags:**\n- The name is open.\n- Ask about refunds.\n" });
  const result = JSON.parse(odyssey(["open", "--json"], { cwd: root }).stdout);
  assert.deepEqual(threads(root), ["last handoff's open flag | directives/handoff/previous.md | The name is open.", "last handoff's open flag | directives/handoff/previous.md | Ask about refunds."]);
  assert.match(result.previous.date, /^\d{4}-\d\d-\d\d$/);
  assert.match(result.recent[0], /^\d{4}-\d\d-\d\d [0-9a-f]+ base$/);
  assert.match(odyssey(["open"], { cwd: root }).stdout, /^Where you left off: the last handoff, \d{4}-\d\d-\d\d \(directives.handoff.previous\.md\)\.\nLast commits: /);
});

// --- which-one, the invocation policy, wrap-up ----------------------------------------------

const skillText = (name) => readFileSync(path.join(PLUGIN, "skills", name, "SKILL.md"), "utf8");

test("which-one's map names every other skill", () => {
  const rows = skillText("which-one").split("\n").filter((line) => line.startsWith("| ") && !line.startsWith("| You want to"));
  const mapped = new Set(rows.flatMap((line) => [...line.matchAll(/`\/odyssey:([a-z-]+)/g)].map((match) => match[1])));
  const others = readdirSync(path.join(PLUGIN, "skills")).filter((name) => name !== "which-one");
  assert.deepEqual(others.filter((name) => !mapped.has(name)), []);
});

test("Claude can start only the skills the invocation policy names; every other skill is typed", () => {
  const invoked = readdirSync(path.join(PLUGIN, "skills")).filter((name) => !/^disable-model-invocation: true$/m.test(skillText(name)));
  assert.deepEqual(invoked.sort(), ["cr-triage", "grill-me", "heal-me", "prove-it", "remember-session", "which-one"]);
  // index-it's two callers read it by path, since Claude can't start it.
  assert.match(skillText("remember-session"), /read\s+`<this skill's base directory>\/\.\..index-it.SKILL\.md`/);
  assert.doesNotMatch(skillText("remember-session"), /the Skill tool/);
});

test("wrap-up reads what it writes from in one call, writes memory, the handoff and the launcher check in one call, and loads the jobs-and-agents and index steps only when they apply", () => {
  const skill = skillText("wrap-up");
  const wait = readFileSync(path.join(PLUGIN, "skills", "wrap-up", "references", "stop-and-wait.md"), "utf8");
  assert.match(skill, /read `references\/stop-and-wait\.md` beside this file and follow it first\.\s+Otherwise skip this and load nothing for it/);
  assert.match(skill, /\*\*Read, in one Bash call:\*\* `\.\..handoff.references.write\.md`/);
  assert.match(skill, /\*\*Write, in one Bash call\*\* \(heredocs\)/);
  assert.match(skill, /The branch, commits and next step go in the handoff, not in\s+memory/);
  assert.match(skill, /`MEMORY\.md`, then\s+`\[ -n "\$ODYSSEY_LAUNCH" \] && touch "\$ODYSSEY_LAUNCH\.quit"/);
  assert.match(skill, /read\s+`\.\..index-it.SKILL\.md` \(from this skill's folder\) and run its `apply` job without asking \(it\s+never deletes\)\. Otherwise skip it and load nothing for it/);
  assert.doesNotMatch(skill, /`\.\..handoff.SKILL\.md`|CronList/);
  assert.match(wait, /If this session scheduled jobs, `CronList`, then `CronDelete` each one/);
  assert.match(wait, /Let it finish\. Run wrap-up's steps 2 to 5 while it works; the Stop hook holds a launched\s+session's relaunch/);
  assert.match(wait, /must not be cut off: let it finish and start nothing new\.\s+Fold its result into memory and the handoff when it ends\./);
  assert.match(wait, /commits what's done\s+locally \(if the commit gate blocks it, it leaves the work uncommitted and lists the changed\s+files in its handoff file\)/);
});

test("setup runs each gate stage it proposes once and leaves out one that fails on the untouched repo, and checks a fix command's program without running it", () => {
  const skill = skillText("setup");
  assert.match(skill, /Before proposing them, run each stage once from the repo root, as the commit gate would/);
  assert.match(skill, /check each fix command's\s+program with `command -v` \(running a fix changes files\)/);
  assert.match(skill, /Leave out\s+one that fails on the\s+untouched repo, since it would block every commit/);
});

test("setup asks for the interview's answers once, as one filled-in proposal, and offers the machine extras and ponytail in one call, as multi-select questions within the tool's four-option limit", () => {
  const skill = skillText("setup");
  assert.match(skill, /ask once: "Yes, or change N\?"/);
  assert.doesNotMatch(skill, /until the user has\s+confirmed each group/);
  assert.match(skill, /The end-user identifiers, free text, payloads and hot path default to none/);
  assert.match(skill, /in one call of the question tool, a line each, as multi-select questions of at most four\s+options each \(the tool's limit\)/);
  assert.doesNotMatch(skill, /one multi-select question/, "six options can't fit one question");
  assert.match(skill, /the status bar, the launcher, the tips\s+and the wrap-up band marked recommended, and peek and ponytail not, since peek is experimental\s+and ponytail is another author's plugin/);
  assert.match(skill, /- \*\*Ponytail\*\* \(its two install commands\): a separate plugin/);
  assert.doesNotMatch(skill, /## \d+\. Ponytail|Enable\s+ponytail in every session\?/, "ponytail has no question of its own");
  assert.doesNotMatch(skill, /Offer yes first, as\s+the recommended answer/);
});

test("setup's preflight times each gate stage and leaves out the slowest, one at a time, until the rest fit the gate's budget, and runs the docs stage the gate runs after them", () => {
  const skill = skillText("setup");
  assert.match(skill, /with\s+the Bash tool's timeout at 600000 ms, and show how long each took/);
  assert.match(skill, /The gate gives all its stages\s+570 s together, so when the kept ones take more than about 500 s, leave out the slowest, one\s+at a time, until the rest take under about 500 s, and say why for each\./);
  assert.match(skill, /Then run `node <this skill's base directory>\/\.\.\/\.\.\/scripts\/odyssey\.mjs docs check`/);
  assert.match(skill, /Show its errors and offer to fix them before the user approves the gate/);
});

test("handoff reads timers and the message and resets the slot in one command, quotes only the First line, and loads write and timers only when used; the ask rule decides open choices", () => {
  const handoff = skillText("handoff");
  const ref = (name) => readFileSync(path.join(PLUGIN, "skills", "handoff", "references", name), "utf8");
  assert.match(handoff, /Otherwise run one Bash\s+call from the repo root/);
  assert.match(handoff, /sed 's\/<!--\.\*-->\/\/' \$d\/current\.md \| grep -q '\[\^\[:space:\]\]' &&\s+cp \$d\/current\.md \$d\/previous\.md/);
  assert.match(handoff, /With `write`, read `references\/write\.md` beside this file/);
  assert.match(handoff, /When `--- timers` printed entries, read `references\/timers\.md`/);
  assert.match(handoff, /\*\*Quote\*\* the message's \*\*First\*\* line/);
  assert.match(handoff, /open the files and lines\s+its \*\*First\*\* names directly, without searching around them/);
  assert.doesNotMatch(handoff, /verbatim|CronCreate|## Timers/);
  assert.match(ref("write.md"), /naming the exact files and line ranges it reads and changes,\s+so the next session opens them without searching/);
  assert.match(ref("timers.md"), /`CronCreate` it \(`recurring: false`/);
  const ask = readFileSync(path.join(PLUGIN, "scaffold/.claude/rules/odyssey/primary.md"), "utf8");
  assert.match(ask, /Take the reading the request or the repo supports and build it/);
  assert.match(ask, /Ask\s+first only when a wrong guess would be costly to undo/);
});

test("the wrap-up mod's old names are gone from the kit", () => {
  // Spelled in pieces, so this file doesn't hold the words it looks for.
  const [home, island] = ["Home" + "ward", "Ith" + "aca"];
  const old = new RegExp(`${home}|${island}`);
  assert.ok(old.test(`the ⛵ ${island} band, from ${home}`), "the pattern catches its own planted string");
  const hits = [];
  for (const file of readdirSync(PLUGIN, { recursive: true })) {
    if (!/\.(md|mjs|ts|tsx|json|yml|sh)$/.test(file) || file.split(path.sep).includes("node_modules")) continue;
    readFileSync(path.join(PLUGIN, file), "utf8").split("\n").forEach((line, i) => {
      if (old.test(line)) hits.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, []);
});
