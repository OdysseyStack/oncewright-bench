// Checks for the stamped-file guard: a file whose first line is the odyssey-managed
// stamp is blocked for Edit, Write, MultiEdit and NotebookEdit, a first line that only
// mentions it is not, anything else is allowed, and an error fails open.
//
// Like protect-env.test.mjs, each check runs the hook as a process with a JSON payload
// on stdin and reads its exit code. Offline and deterministic: the fixtures are small
// files in a scratch dir.
//
// Run: node --test hooks/protect-managed.test.mjs
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("./protect-managed.mjs", import.meta.url));
const root = realpathSync(mkdtempSync(path.join(tmpdir(), "protect-managed-")));

after(() => {
  // Verify the location before anything destructive, as protect-env.test.mjs does.
  assert.ok(root.startsWith(realpathSync(tmpdir()) + path.sep), "scratch dir is under tmpdir");
  assert.ok(path.basename(root).startsWith("protect-managed-"), "scratch dir is ours");
  rmSync(root, { recursive: true, force: true });
});

const STAMP = `<!-- odyssey-managed v1.0.0 sha256:${"0".repeat(64)} -->`;
const stamped = path.join(root, "primary.md");
const plain = path.join(root, "project.md");
const stampLater = path.join(root, "notes.md");
writeFileSync(stamped, `${STAMP}\n# Primary rules\n`);
writeFileSync(plain, "# Project rules\n");
writeFileSync(stampLater, `# Notes\n${STAMP}\n`);

const run = (input) => spawnSync(process.execPath, [HOOK], { input, encoding: "utf8" });
const call = (tool, file_path) => run(JSON.stringify({ tool_name: tool, tool_input: { file_path } }));

test("a stamped file is blocked for Edit, Write, MultiEdit and NotebookEdit", () => {
  for (const tool of ["Edit", "Write", "MultiEdit"]) assert.equal(call(tool, stamped).status, 2, tool);
  const notebook = (notebook_path) => run(JSON.stringify({ tool_name: "NotebookEdit", tool_input: { notebook_path } }));
  assert.equal(notebook(stamped).status, 2, "NotebookEdit names its file in notebook_path");
  assert.equal(notebook(plain).status, 0);
  assert.match(call("Edit", stamped).stderr, /Put project rules in CLAUDE\.md/, "the message points to project rules");
});

test("an unstamped file is allowed", () => {
  assert.equal(call("Edit", plain).status, 0);
  assert.equal(call("Edit", stampLater).status, 0, "the stamp counts only on the first line");
});

test("only the stamp's whole line is the stamp, whatever the line ending", () => {
  const file = (name, text) => {
    writeFileSync(path.join(root, name), text);
    return path.join(root, name);
  };
  const mention = file("stamp-notes.md", "# How the odyssey-managed stamp works\n");
  const noHash = file("no-hash.md", "<!-- odyssey-managed v1.0.0 -->\n# Rules\n");
  assert.equal(call("Edit", mention).status, 0, "a first line that mentions the stamp is the user's");
  assert.equal(call("Edit", noHash).status, 0, "a stamp line without its hash is not the stamp");
  assert.equal(call("Edit", file("crlf.md", `${STAMP}\r\n# Primary rules\r\n`)).status, 2, "a CRLF checkout keeps its stamp");
  assert.equal(call("Edit", file("bom.md", `\uFEFF${STAMP}\n# Primary rules\n`)).status, 2, "so does a byte-order mark before it");
});

test("a new file and an unreadable payload fail open", () => {
  assert.equal(call("Write", path.join(root, "new.md")).status, 0);
  assert.equal(run("not json").status, 0);
});
