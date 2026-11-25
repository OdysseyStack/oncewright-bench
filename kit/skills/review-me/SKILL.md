---
name: review-me
description: Reviews changes since a fixed point against the repo's standards and against what the plan or order asked for, side by side. Use when the user wants a branch or a finished slice reviewed.
disable-model-invocation: true
---

# Review me

Built from Matt Pocock's `code-review` (mattpocock/skills v1.3.1, MIT); see Credits in the kit's
README for what changed and why.

Two axes, kept apart so one can't hide the other:

- **Standards**: does the change follow this repo's written rules?
- **Spec**: does it do what the plan or the request asked for, and nothing else?

Code can follow every rule and build the wrong thing, or build exactly the right thing against the
repo's conventions. This skill reports; it edits nothing.

## 1. Pin the fixed point

The ref the user gave; else the commit the plan's slice started from (its record line, or the branch's merge-base with the main branch). Run
`git rev-parse <ref>`, then make sure `git diff <ref>` (committed and uncommitted work together)
or the new files `git status --porcelain --untracked-files=all` lists as `??`, which the diff
leaves out, hold something, before starting anything. Both axes get each new file's contents with
the diff. Note `git log --oneline <ref>..HEAD` as well.

## 2. Find the spec

In order: the plan slice in `docs/plans/` the commits name; a path the user gives. With
none, ask. If there is none, the Spec axis is skipped and the report says so.

## 3. Find the standards

The project's instruction file (`CLAUDE.md`, or `AGENTS.md` when the repo has no `CLAUDE.md`),
`.claude/rules/`, `CONTRIBUTING.md` or any coding-standards file, and the ADRs that cover the
changed files. Leave out what already runs on every change: the linter and formatter, the gate's
stages, and what `.coderabbit.yaml` tells CodeRabbit to check.

On top of those, the Standards axis carries this baseline of code smells (Fowler, *Refactoring*,
chapter 3). The repo's written rules override it, and each smell is a judgment call ("possible
feature envy"), never a hard violation:

- **Mysterious name**: a name that doesn't say what it does or holds → rename it.
- **Duplicated code**: the same logic in more than one hunk or file → extract it once.
- **Feature envy**: a function that uses another object's data more than its own → move it there.
- **Data clumps**: the same few values always travelling together → make them one type.
- **Primitive obsession**: a string or number standing in for a domain concept → give it a type.
- **Repeated switches**: the same branching on the same kind, in several places → one map or
  polymorphism.
- **Shotgun surgery**: one change forcing edits across many files → gather what changes together.
- **Divergent change**: one file edited for unrelated reasons → split it.
- **Speculative generality**: parameters, hooks or layers no requirement asks for → delete them.
- **Message chains**: `a.b().c().d()` walks a caller shouldn't depend on → one method on `a`.
- **Middle man**: a module that mostly passes calls on → call the real target.
- **Refused bequest**: a subtype that ignores most of what it inherits → compose instead.

## 4. Two subagents, in parallel

Start both in the foreground together and wait for each.

- **Standards** gets the diff command, the commit list, the standards files, and the smell
  baseline above pasted in full. Brief: "Report, per file and hunk, (a) each breach of a written
  standard, citing the file and the rule, and (b) any baseline smell, named, with the hunk quoted.
  A written-rule breach can be hard; a smell is always a judgment call. Under 400 words."
- **Spec** gets the diff command, the commit list and the spec's path. Brief: "Report (a) what the
  spec asked for that is missing or partial, (b) what the diff does that wasn't asked for, and
  (c) what looks implemented but wrong. Quote the spec line for each. Under 400 words."

## 5. Report

The two reports under `## Standards` and `## Spec`, as returned or lightly cleaned, never merged
or re-ranked across axes. End with one line: the number of findings on each axis and the worst one
within each. A fix the user wants is then made like any other change.
