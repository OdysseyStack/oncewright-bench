#!/usr/bin/env node
// PreToolUse hook: protect append-only journals and read-only files.
//
// Two distinct protections, both deterministic backstops for rules otherwise
// enforced only by discipline:
//
//   READ_ONLY   -> block Edit, Write, and MultiEdit entirely. Every Claude Code
//                  session in this repo runs this hook, so list only
//                  files a human maintains; Claude reports the needed
//                  change instead of editing.
//   APPEND_ONLY -> block Write/MultiEdit (a Write replaces the whole file - that
//                  is a truncation). Appends go through Edit, allowed only when the
//                  new text keeps the old text whole and adds after it, and the old
//                  text is the end of the file, so an entry lands last.
//
// Matching is on basename, case-insensitively.
// Exit code 2 signals "block"; stderr is shown back to Claude.
//
// Opt-in: it runs only when `hooks.protectAppendOnly` is true in .claude/odyssey.json,
// which lists the files in `protect.readOnly` and `protect.appendOnly`.
import { readFileSync } from "node:fs";
import path from "node:path";
import { hookInput } from "../lib/config.mjs";

let input;
try {
  input = hookInput();
} catch {
  process.exit(0);
}
const { payload, config } = input;
if (config.hooks?.protectAppendOnly !== true) process.exit(0);

const names = (list) => new Set((list ?? []).map((name) => name.toLowerCase()));
// e.g. "audit-log.md" - an audit log only a human edits
const READ_ONLY = names(config.protect?.readOnly);
// e.g. "journal.md" - a session journal Claude appends to
const APPEND_ONLY = names(config.protect?.appendOnly);

if (READ_ONLY.size === 0 && APPEND_ONLY.size === 0) process.exit(0);

const filePath = payload?.tool_input?.file_path;
if (!filePath) process.exit(0);

const base = path.basename(filePath).toLowerCase();
const tool = payload?.tool_name ?? "";

if (READ_ONLY.has(base)) {
  process.stderr.write(
    `Blocked: "${base}" is read-only in this repo. ` +
      `Do not modify it; report the needed change instead.\n`,
  );
  process.exit(2);
}

if (APPEND_ONLY.has(base) && tool !== "Edit") {
  process.stderr.write(
    `Blocked: "${base}" is append-only - never truncate it. A ${tool} replaces the file ` +
      `wholesale. Append your timestamped entry with the Edit tool instead.\n`,
  );
  process.exit(2);
}

// An Edit swaps old_string for new_string. It is an append only when new_string starts
// with old_string whole, so nothing already in the file is removed or rewritten, and when
// old_string is the end of the file, so the entry lands after everything already there. The
// Edit tool refuses an old_string that occurs more than once, and replace_all is blocked here,
// so the first match is where the Edit lands, and only blank space may follow it. The file
// is read as the Edit tool matches it, with Windows line endings as "\n".
if (APPEND_ONLY.has(base)) {
  const oldText = payload?.tool_input?.old_string ?? "";
  const newText = payload?.tool_input?.new_string ?? "";
  if (payload?.tool_input?.replace_all || !newText.startsWith(oldText) || newText === oldText) {
    process.stderr.write(
      `Blocked: "${base}" is append-only - this Edit changes existing text. Keep the old ` +
        `text whole in new_string and add your entry after it.\n`,
    );
    process.exit(2);
  }
  let current = null;
  try {
    current = readFileSync(filePath, "utf8").replaceAll("\r\n", "\n");
  } catch {
    // Unreadable or missing: the Edit itself fails, so there is nothing to guard.
  }
  const at = current === null ? -1 : current.indexOf(oldText);
  if (current !== null && (at < 0 || current.slice(at + oldText.length).trim() !== "")) {
    process.stderr.write(
      `Blocked: "${base}" is append-only - a new entry goes at the end. Anchor the Edit on ` +
        `the file's last lines and add your entry after them.\n`,
    );
    process.exit(2);
  }
}

process.exit(0);
