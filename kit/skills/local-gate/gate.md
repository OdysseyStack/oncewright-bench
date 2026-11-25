# The gate

How the kit runs a repo's pre-push gate, the same stages CI runs, and reports it.
`/odyssey:local-gate` follows this file when you invoke it, and `/odyssey:db-migration` when it
runs the gate itself. When the config names `gate.stages`, the commit gate
(`hooks/bash-guard.mjs`) runs it before each `git commit` Claude runs, as a script: the
configured stages and the docs stage, each to its end, with no fallback stages; a failing stage
blocks the commit.

## The stages

**The stages come from the config**, which the skill reading this file has loaded with
`scripts/odyssey.mjs config`: `config.gate.stages`, each with a `name` and a `command`, run as
written. With no `gate.stages`, fall back to the package scripts `lint`, `typecheck`, `test` and
`build`, those that `package.json` defines, each run as `npm run <name>`, and say the stages came
from there. With neither, report that this repo defines no gate stages, and stop.

**The docs stage** runs beside them in every mode, as the stage named `docs`: from the repo root,
`node <this file's folder>/../../scripts/odyssey.mjs docs check`, the kit's check of the docs'
claims (each `@` import names a file, named paths and file names exist, `npm run` names a
script, cited ADRs exist, no personal skill shadows a repo skill), then the repo's own docs
check when the config names `docs.check`. It is a script, so it costs no model tokens. It fails
on an error; carry its warnings into the report. When the kit's check prints `0 files checked`
and the config names no `docs.check`, the repo has no docs: skip the stage and name the skip.

## Running them

**Run every selected stage even if an earlier one fails** — do not stop at the first failure.
The whole point is to surface the complete blast radius in one pass instead of one fix/rerun
cycle per stage. Run each stage independently and capture its exit status and output.

Any offline validation harnesses this repo keeps run here too. One that requires a live
service is a deliberate skip: name it with the reason rather than letting it block the gate.
One that hangs did not run, which makes the verdict INDETERMINATE (below).

## Report

Print a compact table — one row per stage — then a one-line overall verdict:

| Stage | Result | First failure (if any) |
|-------|--------|------------------------|
| lint | pass / fail | `file:line` + the message |
| typecheck | pass / fail | `file:line` + the message |
| test | pass / fail | failing test name + assertion |
| build | pass / fail / skipped | `file:line` + the message |
| docs | pass / fail / skipped | the first `error:` line |

- For each failed stage, surface only the **first / most relevant** error with its `file:line`
  — not the whole tool dump.
- Call out this repo's recurring failure mode explicitly when you see it (e.g. a relative
  import missing its `.js` extension under NodeNext, showing up in `typecheck`/`build`).

### The verdict — three states, each carrying its denominator

A bare "all green" is the failure this gate exists to prevent, so never print a verdict
without the count it is over:

- **GATE GREEN — N/N stages passed** — every selected stage ran and exited 0. Name any
  deliberate skip with its reason (`+ build skipped: fast mode`). Add "safe to push" only when
  nothing was skipped; after a skip, name the stage that still has to pass before a push.
- **GATE RED — K of N stages failing** — name every failing stage.
- **GATE INDETERMINATE — <stage> did not run** — a stage expected to run did not: it hung,
  errored before running anything, or ran nothing (a test runner that collected zero
  tests, a glob that matched no files). Report INDETERMINATE, never GREEN — whatever the
  exit codes say, that part of the gate did not run.
