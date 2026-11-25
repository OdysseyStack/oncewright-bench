---
name: make-a-path
description: Says where the current work stands and the one command that moves it on, read from the repo. Use when you've lost the thread of the current piece of work.
disable-model-invocation: true
---

# Make a path

Answer from what is on disk, not from memory: where the work in front of the user stands, and
the one command that moves it on. `/odyssey:what-next` answers a different question: which piece
of work to pick up.

## 1. The pull request

With `gh` installed and signed in, run `gh pr list --head <branch> --state open --json number,url`
for the checked-out branch. Without `gh`, say so in **Here** and go on.

## 2. Where the repo is

Run `node <this skill's base directory>/../../scripts/odyssey.mjs next --json` from the repo root.
Add `--pr-open` when step 1 found an open pull request, and `--compacted` when this session was
compacted (it opens with a summary of earlier turns). The script reads files and git only and
writes nothing. It returns `here` (what it read), `next` (the first rule that matched, with why)
and `also` (the next two). Its rules, first match wins: setup missing → `/odyssey:setup`;
handoff waiting → `/odyssey:handoff`; compacted session → `/odyssey:handoff write`; findings
untriaged → `/odyssey:cr-triage`; commits ahead with no pull request → the pre-push CodeRabbit
CLI review, then push and open one; a plan or grilling record not grilled → `/odyssey:grill-me`; a
grilled ACTIVE plan → its next slice; nothing open → wait.

Two calls are yours:
- **An open pull request** replaces any rule from "commits ahead" down with
  `/odyssey:cr-triage <number>`, which checks whether a review round is waiting.
- **A grilled plan:** read its status lines and name the first slice not recorded as landed.
  When every slice has landed, Next is setting the plan's status header to `CLOSED <sha>`.

## 3. Print

- **Here:** one line: the branch, changed files, commits not pushed, the slots, the pull request.
- **Next:** one command, and the rule that fired.
- **Also:** at most two, from `also`.
- **Boundary:** where the next step runs. This session; a cleared one (`/clear`) when this one
  is long or about something else; a new session after `/odyssey:handoff write` when what is in
  context must survive; an agent when the step is handed off. Never suggest `/compact` by
  default: it summarizes away what the next step needs. When unsure, write it to disk first.
