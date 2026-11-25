---
name: remember-session
description: Saves this session's rulings, corrections, state and facts to memory. Use for "update memory", "remember this session", "save session context", or before closing a session.
---

# Remember Session

Sweep the whole session and land everything durable in the persistent memory
directory named in your system prompt (the file-per-fact store indexed by
`MEMORY.md`). The completion bar: every ruling, correction, and state change
from the session is either in a memory file or deliberately skipped as
repo-recorded — nothing left implicit.

## 1. Harvest, by class

Walk the session start to end and list candidates:

- **Rulings and decisions** the user made, with the why behind each (type:
  `project`, or `feedback` when it governs how you work).
- **Corrections** — process feedback, assumptions the user or the evidence
  overturned. Capture the user's own words where they are sharp (type:
  `feedback`, with **Why** and **How to apply**).
- **State changes** to ongoing work: what shipped, what is authored but
  unexecuted, branch/commit state, operator or env actions confirmed done
  (type: `project`).
- **External facts** the repo cannot record: consoles, tenants, vendor
  behavior, dashboard values, CLI gotchas (type: `reference` or `project`).
- **Refuted or stale claims** — anything this session proved wrong in an
  existing memory or a doc the memories point at.

## 2. Filter

Skip what the repo already records (code, commits, tracked docs, CLAUDE.md)
and what mattered only inside this conversation. A near-empty harvest is a
valid result — report it rather than padding.

## 3. Reconcile before writing

For each keeper, search `MEMORY.md` and the memory directory for the file
that already owns the topic:

- An owner exists → **update it** rather than creating a sibling file: add to its
  body, and refresh its `description:`.
- The session refuted a memory → add the correction and mark the refuted claim
  superseded; never edit it away or delete the memory. Text already in a memory stays as
  written, the rule `/odyssey:index-it` keeps too: new text is only added.
- A correction memory already holds, given again this session → memory didn't stop it, so
  also propose the one line for the repo's rules or CLAUDE.md that would, and add it once the
  user says yes.
- No owner → new file per the store's frontmatter schema. Convert relative
  dates to absolute; link related memories with `[[name]]`.
- Append-log memories (sprint maps, running state files) → prepend the new
  state block at the top and mark any now-superseded sections below as
  superseded, so the next session reads current truth first.

## 4. Index

Update `MEMORY.md`: one line per touched memory, hook-first wording — the
next session decides relevance from that line alone. The index carries
pointers, never content.

Then check that the index still fits what Claude Code loads, the first 200
lines or 25 KB of `MEMORY.md`. When the index you just wrote is plainly under
100 lines and 10 KB, that is the check: say so and skip the survey. Otherwise
run `/odyssey:index-it`'s survey from the project directory:

```bash
python3 <this skill's base directory>/../index-it/scripts/survey.py --sessions 0
```

Its `index` object gives the `bytes` and the `lines`, and whether they are past
the target (16 KB or 150 lines: `over_target`) or the ceiling (24.4 KB or 200
lines: `over_ceiling`). Past the ceiling the tail of the file is silently cut
out of context and those memories stop loading at all — say that plainly, and
name the last few lines as the ones at risk. When `exists` is false, `store` is
not the memory directory you just wrote to, or `python3` is missing, say so in
the report and skip §6. Do not restructure here; that is `/odyssey:index-it`'s job,
and doing it mid-harvest mixes two different kinds of judgment.

## 5. Report

List files created, updated, and deleted, each with a one-line reason, so the
user can audit what memory now claims. Every harvested item traces to a file
or an explicit skip. Give the index's bytes and lines.

## 6. Past the target, run index-it

`/odyssey:wrap-up` runs §1–§5 and runs the index step itself, in place of this step.

When `over_target` is true, read
`<this skill's base directory>/../index-it/SKILL.md` and run it from its own folder
once the report is out, and say so in the report's last line. That run only
proposes: it writes nothing, and the restructure happens when the user runs
`/odyssey:index-it apply`.
