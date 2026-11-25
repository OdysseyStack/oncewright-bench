---
name: untangle
description: Finds where tangled modules make change hard, saves the ranked candidates as a report, and grills the one you pick into a plan. Use for an architecture review or to ask where to refactor.
disable-model-invocation: true
---

# Untangle

Built from Matt Pocock's `improve-codebase-architecture` (mattpocock/skills v1.3.1, MIT); see
Credits in the kit's README for what changed and why.

Find **deepening opportunities**: refactors that turn shallow modules into deep ones, so the code
is easier to test and to find your way around. Read `../shape-it/SKILL.md` first and use its words
exactly (module, interface, depth, seam, adapter, leverage, locality). Read `GLOSSARY.md` and the
ADRs in `docs/adr/` too: the glossary names good seams, and an ADR records a decision not to
re-argue.

## 1. Decide where to look

Deepening pays off where code keeps changing, so scope before you scan:

- If the user named a direction (a module, a subsystem, a pain point), take it.
- Otherwise find the hot spots: the files `git log --name-only` shows changing most over a good
  stretch of history, and the deferred items in `docs/plans/`. With no clear hot spot, widen the
  net.

## 2. Walk the code

Start a subagent to explore the chosen area and note where it meets friction:

- understanding one concept means bouncing between many small modules;
- a module is shallow, its interface nearly as complex as its implementation;
- pure functions were pulled out just for testing, while the bugs hide in how they're called;
- tightly coupled modules leak across their seams;
- code is untested, or hard to test through its current interface.

Apply the deletion test to anything that looks shallow: would deleting it concentrate complexity,
or just move it? "Concentrates" is the signal.

## 3. Save the report, twice

Write both files to `docs/untangle/` in the repo, creating the folder if needed:

- `<YYYY-MM-DD>-<slug>.md`, the record: per candidate its **Files**, **Problem** (one sentence),
  **Solution** (one sentence), **Wins** (in locality and leverage terms, and how the tests
  improve), a before/after diagram as a Mermaid block, its **Strength** (`Strong`,
  `Worth exploring` or `Speculative`), and an ADR it contradicts, raised only when the friction is
  worth reopening the ADR. It ends with the top recommendation and why.
- `<YYYY-MM-DD>-<slug>.html`, the same candidates as a page to look at, built as
  `html-report.md` beside this file says.

Print both absolute paths. Never open them for the user: over SSH there is no browser to open.
Propose no interfaces yet. Ask: "Which of these would you like to explore?"

## 4. Take the chosen one into a plan

- **Picked:** write a plan for it in `docs/plans/<YYYY-MM-DD>-<slug>.md` (status `ACTIVE`) and run
  `/odyssey:grill-me` on it: the constraints, the dependencies, the deepened module's shape, what
  sits behind the seam, which tests survive. `/odyssey:name-it` keeps the glossary current as
  terms settle; to compare alternative interfaces, use the design-it-twice steps in
  `../shape-it/deepening.md`.
- **Rejected for a reason a later review would need:** offer an ADR, "so a later review doesn't
  suggest it again", when `/odyssey:name-it`'s three tests hold. Skip reasons that won't last
  ("not now") or that are obvious.
