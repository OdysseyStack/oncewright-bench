#!/usr/bin/env node
// PreToolUse hook: keep Claude's edit tools off the files /odyssey:setup stamped.
//
// A kit-owned file, such as a rule in .claude/rules/odyssey/, starts with the line
// <!-- odyssey-managed v<version> sha256:<hash> -->, and re-running /odyssey:setup
// upgrades it by that hash. An edit in place would turn the next upgrade into a diff to
// approve, so Edit, Write, MultiEdit and NotebookEdit are blocked on any file whose first
// line is the stamp, whole (lib/stamp.mjs): a first line that only mentions it is the user's.
// Always on: in a repo with no stamped files it never blocks.
//
// Fails open: any error (no payload, a file that does not exist yet) exits 0.
// Exit code 2 signals "block" to Claude Code; the stderr text is shown back.
import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { STAMP } from "../lib/stamp.mjs";

try {
  const input = JSON.parse(readFileSync(0, "utf8"))?.tool_input;
  const filePath = input?.file_path ?? input?.notebook_path; // NotebookEdit's field
  const fd = openSync(filePath, "r");
  const head = Buffer.alloc(512); // the stamp line is about 100 bytes
  const size = readSync(fd, head, 0, head.length, 0);
  closeSync(fd);
  if (STAMP.test(head.toString("utf8", 0, size).split("\n", 1)[0])) {
    process.stderr.write(
      `Blocked: ${filePath} is managed by the Odyssey kit: its first line carries the ` +
        `odyssey-managed stamp, and /odyssey:setup upgrades it. Put project rules in ` +
        `CLAUDE.md instead. To take the file over, a human removes the stamp line.\n`,
    );
    process.exit(2);
  }
} catch {
  // fail open
}
process.exit(0);
