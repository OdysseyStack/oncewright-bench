---
name: grill-me
description: Interviews the user one question at a time to stress-test a plan or idea. Use when the user says "grill me" or wants a plan stress-tested.
---

# Grill me

Built from Matt Pocock's `grilling`, `grill-with-docs`, `to-questionnaire` and `to-spec`
(mattpocock/skills v1.3.1, MIT); see Credits in the kit's README for what changed and why.

Interview the user until you both understand the plan the same way. Map it as a **design tree**:
every decision branches into the decisions that hang off it. The **frontier** is every decision
whose prerequisites are already settled, the questions you could ask now without guessing at
answers you haven't heard yet.

## 1. Find the record, or start one

- **A plan is named** (a path, or "the plan" when `docs/plans/` has one `ACTIVE` plan): the record
  is that plan's `## Grilling record` section. Add the heading at the end if it is missing.
- **No plan**: the record is `docs/grills/<YYYY-MM-DD>-<slug>.md`, created now as a minimal plan:

  ```markdown
  **Status:** GRILLING — started <YYYY-MM-DD>

  # <title>

  ## Problem
  ## Decisions
  ## Testing seams
  ## Out of scope
  ## Open
  ## Grilling record
  ```

- **The record already holds G-lines**: this is a resume. Read them, count on from the last
  number, never re-ask a settled line, and start from the frontier they leave. A
  `Grilling done` line means the grilling finished; ask whether to reopen it before going on.

When the repo has a `GLOSSARY.md`, a `GLOSSARY-MAP.md` or a `docs/adr/`, read
`../name-it/SKILL.md` and follow it alongside this skill: terms are challenged and resolved as
you go, and the glossary and ADRs are written when that skill says.

## 2. One question at a time

Compute the whole frontier, but ask only its most upstream question, with your recommended
answer, and say how many others the frontier holds. Hold the rest silently: an answer may reword
or retire them.

```
❓ **G<n>** - **<question title>**: <question body, choices if there are any>

➡️ <your recommended answer>

(<k> more on the frontier)
```

Finding **facts** is your job, never the user's. When a question needs a fact from the repo or
the machine, look it up, or start a subagent to, instead of asking. Questions that depend on a
lookup still running leave the frontier until it reports; ask from what remains. The
**decisions** are the user's: put each one to them and wait.

## 3. Write the answer before the next question

When the user answers, append one line to the record **before** asking anything else:

```
G<n> — <question>: <decision>. Why: <reason>.
```

The reason is the user's, in their words where they gave one. When the decision changes what the
plan says, edit that section of the plan too (or `## Decisions` in a grills file). Then
recompute the frontier and ask the next question. A session that ends mid-grilling loses nothing
already answered.

A question only someone else can answer (a teammate, a client, a vendor) is not guessed. Write
it as an open line and move on:

```
G<n> — <question>: OPEN, ask <who>. Why it matters: <what it decides>.
```

## 4. Done

The grilling is done when the frontier is empty: every branch visited, nothing silently assumed.
Ask the user to confirm you share one understanding, then append:

```
Grilling done <YYYY-MM-DD>: <settled> settled, <open> open.
```

List the open lines grouped by who to ask, so the user can send them. Do not act on the plan
until the user says so. Then offer the next step: make the plan's first slice directly.
