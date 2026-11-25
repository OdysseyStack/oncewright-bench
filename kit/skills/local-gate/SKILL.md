---
name: local-gate
description: Runs every gate stage, CI's plus a docs check, and reports pass or fail per stage. Use before a push or to ask "am I green?". Modes fast and fix.
disable-model-invocation: true
---

# Local Gate

Run this repo's pre-push gate — the same stages CI runs — and report one consolidated
summary. This is a user-triggered convenience: it never commits or pushes. The default and
`fast` modes only read;
`fix` mode edits files through the fix commands (`gate.fix`), so run it only on changes inside
the files the current slice or request touches.

## Modes (from the skill arguments)

- **(default)** — run all stages.
- **`fast`** — inner-loop check: skip the stage named `build`, which mostly re-confirms
  `typecheck`, and name the skip in the verdict. With no stage named `build`, run them all.
- **`fix`** — auto-fix first (each `gate.fix` command, in order), then run the gate. With no
  `gate.fix`, say there is nothing to auto-fix and run the gate.

Modes combine, e.g. `fix fast`.

## How to run

Run `node <this skill's base directory>/../../scripts/odyssey.mjs config` from the repo root. It
prints `{ root, file, config, notice }`. A `notice` means the config file is invalid: show it,
since the gate then runs on the fallback stages. No config (`file` is null): say once "run
`/odyssey:setup` to tailor this repo".

Then run the gate as [`gate.md`](gate.md) in this folder says, in the mode the arguments picked:
where the stages come from, how each one runs, and the report with its three-state verdict.

Stop after reporting. Pushing remains a separate, explicitly approved step.
