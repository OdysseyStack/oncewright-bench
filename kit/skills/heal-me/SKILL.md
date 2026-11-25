---
name: heal-me
description: Builds a check that fails on a bug, then fixes it with a regression test. Use when something breaks (a failing test, a red gate, a stack trace, a slowdown) or the user reports a bug.
---

# Heal me

Built from Matt Pocock's `diagnosing-bugs` (mattpocock/skills v1.3.1, MIT), around the
self-annealing loop from Nick Saraev's DOE framework; see Credits in the kit's README for what
changed and why.

Read `GLOSSARY.md` when the repo has one, and the ADRs in `docs/adr/` that cover the code
involved.

**Redact first.** Every command, output and captured file you show has each secret replaced with
`<REDACTED>`. Keep credentials in environment variables so they never appear in a command, and
quote only the lines that carry the signal. If the redacted output isn't enough, say so and ask.

## 1. Build a check that fails on this bug

This is most of the work. With a fast pass/fail check that fails on *this* bug, the cause will be
found; without one, reading code won't find it. Ways to build one, roughly in this order:

- a failing test at the seam that reaches the bug;
- a `curl` or HTTP script against a running dev server;
- the CLI with a fixture input, its output diffed against a known-good copy;
- a headless browser script that asserts on the page, the console or the network;
- a captured request, payload or event log, replayed through the code path on its own;
- a throwaway harness that runs only the failing path;
- many random inputs, for "sometimes wrong";
- `git bisect run` with the check, when it worked at one commit and not at a later one;
- the same input through the old and the new version, diffed.

Tighten it: faster (narrow the scope, skip unrelated setup), sharper (assert the user's exact
symptom, not "didn't crash"), deterministic (pin the time, seed randomness, cut the network). For a
bug that comes and goes, raise how often it fails (loop it, run it in parallel, add load) until
it fails often enough to work against. A step only a person can do (a click, a device) goes to
the user as numbered commands, one per block, saying what to paste back.

**Done when** you can name one command, already run and shown with its output, that drives the
real code path, fails on the user's exact symptom, gives the same verdict every run, takes
seconds, and runs without a person. If you can't build one, stop and say so: list what you tried,
and ask for access to where it happens, a captured artifact (redacted), or permission to add
temporary instrumentation. No hypotheses before this command exists.

## 2. Reproduce, then shrink

Run it and see it fail the way the user described, not with some nearby failure. Then cut inputs,
callers, config and steps one at a time, re-running after each cut, until every piece left is
needed for the failure.

## 3. Rank three to five hypotheses

Each one falsifiable: "If X is the cause, changing Y makes the bug go away." A hypothesis without
a prediction is a hunch; sharpen it or drop it. Show the ranked list to the user before testing,
since they may re-rank it at once, but don't wait on an answer.

## 4. Probe one prediction at a time

Each probe tests one hypothesis's prediction and changes one thing. A debugger beats logs; logs go
only at the boundaries that separate hypotheses. Tag every debug line with one prefix, such as
`[DEBUG-a4f2]`, so removing them is one search. For a slowdown, measure a baseline first, then
bisect: measure, then fix.

## 5. Fix it directly

Make the fix in this session, inside a scope as the kit's scope rule (`primary.md`) sets one:
before the first edit, list the files the fix touches and the regression test's file; touch any
other file only after the user's yes; at the end, name any file changed outside that list. An
agent handed the fix gets a direct brief, with step 1's check and the hypothesis that proved
right in it.

- **Regression test first**, when a seam exists where the test meets the bug as it really
  happens: turn the shrunk case into a failing test there, see it fail, fix, see it pass. If the
  only seam is too shallow to reproduce the bug, say so instead; that gap is a finding for
  `/odyssey:untangle`.
- **Run step 1's check** against the original, unshrunk case: it passes now.
- **Clean up:** `git grep -n "DEBUG-<tag>"` prints nothing, and throwaway harnesses are deleted.
- **Record the fix** like any direct change: the commit message names the hypothesis that proved
  right, so the next debugger learns from it.

## 6. Record what was learned

Put the lesson where the next session will read it, by kind: an operational procedure in its
directive in `directives/`; an architectural decision in a new ADR in `docs/adr/`; a cross-file
invariant in the project's instruction file (`CLAUDE.md`); deferred work in the
plan that owns the slice. **A check before prose:** when a check could have caught the mistake (a
test, a lint rule, a hook, a gate stage), propose that check first; a written rule is for
judgment calls no check can make. The system is now stronger: the same failure is caught sooner next time.
