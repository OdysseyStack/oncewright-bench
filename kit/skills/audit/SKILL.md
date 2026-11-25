---
name: audit
description: "Checks the repo's instruction files as a whole: which load and when, rules that never load, claims the code disproves, rules that clash. Reports a fix for each; edits nothing."
disable-model-invocation: true
---

# Audit

Answer three questions about the files Claude Code reads as instructions in this repo, and
report each finding with its fix. This skill reads and reports; it edits nothing. The user rules
on each finding, and the fixes land as changes made like any other.

## 1. Which files load, and when

Run `node <this skill's base directory>/../../scripts/odyssey.mjs docs check` from the repo root,
and show its instruction-file list as it prints it: each file in the repo with when Claude Code
loads it (at start; when Claude reads a file in a folder or matching a pattern; or never, and
why), the files outside the repo that Claude Code loads beside them, and the load log. When the
log is off, say that `"hooks": { "loadLog": true }` in `.claude/odyssey.json` logs each session's
loads, so the next audit can set what loaded beside what should. The list follows Claude Code's
default **Project instructions** setting; a user who changed it in `/config` loads another set.

## 2. Which rules never reach Claude

Read every file on the list, in the repo and outside it. Then read each Markdown file a loaded
file points to by name, as a path in backticks or a link, without importing it: Claude reads
such a file only if it decides to open it. Report each rule that lives only in a file that
never loads, or only in a file named that way, with its file and line and where it would load:
moved into a loaded file, or imported from one with `@`.

## 3. Which claims the code disproves, and which rules contradict

The docs check's errors and warnings are the mechanical claims: imports, paths, `npm run` names,
ADR citations and shadowed skills. Beyond those, read the code each file describes, and report:

- a claim the code disproves: a behavior the code no longer has, a count that no longer
  matches, a command or flag that no longer exists;
- a line that breaks a rule in `../write-for-claude/SKILL.md` (a sentence Claude would obey
  anyway, one meaning stated in two places, a pointer too weak to fire, a skill Claude can start
  that only ever runs by hand), naming the rule's heading;
- two rules that say different things on one point, in any two files on the list. A file outside
  the repo counts here, and is only read.

## 4. Report

One table per question: file and line → the finding → the fix, as exact old and new text. Then
the docs check's own errors and warnings. Edit nothing, not even an obvious typo: the user rules
on each finding first, and the fixes land as changes made like any other.
