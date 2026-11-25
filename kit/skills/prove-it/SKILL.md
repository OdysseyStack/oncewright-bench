---
name: prove-it
description: "Builds a check that can fail and reports what it shows: a failing test first, or a Confirmed, Denied or Can't tell verdict. Use for test-first work or to check a claim."
---

# Prove it

Built from Matt Pocock's `tdd` (mattpocock/skills v1.3.1, MIT); see Credits in the kit's README
for what changed and why.

One move, two uses: **build a check that can fail, run it, report what it printed.** A check that
could never fail proves nothing: for new behaviour, the first run that matters is the one where it
fails; for a claim, the check is one that would fail if the claim were false.

Read `GLOSSARY.md` when the repo has one, so test names use the project's words, and the ADRs
in `docs/adr/` that cover the files you'll touch.

## Use 1: new behaviour, test first

### Agree the seams first

A **seam** is the public interface a test observes behaviour through, without reaching inside.
Before writing any test, name the seams you'll test at and get the user's yes: you can't test
everything, and agreeing the seams puts the effort on the paths that matter. When the shape of
the interface is itself in question (how deep the module is, where the seam belongs), read
`../shape-it/SKILL.md` for the vocabulary.

When an agent makes the change, settle the seams before handing it off, because the agent can't
ask: its brief names the seam each test sits at, and each test file is among the files it may
change.

### The loop

- **Red before green.** Write one failing test, run it, and see it fail for the reason you
  expect. Then write only enough code to pass it, and run it again.
- **One vertical slice at a time.** One seam, one test, one minimal change per cycle; the next
  test answers what this cycle taught you. Writing every test first and the code after tests the
  shape you imagined, not the behaviour you get.
- **Quote both runs.** The report (or the agent's report, when an agent made the change) shows each
  slice's red run and green run: the command and the lines that decide it.
- **No refactoring inside the loop.** A refactor you notice goes on a list for the user, not into
  the diff.

What makes a test worth keeping, and when to mock, is in `tests.md` beside this file.

## Use 2: a claim, confirmed or denied

When the user asks whether something is true ("does the cache survive a restart?", "confirm or
deny: we never call the API twice"), don't answer from reading code alone. Build the smallest
check that would come out differently if the claim were false, run it, and answer with one of:

- **Confirmed**: the check could have failed and passed;
- **Denied**: it failed, with the counter-example;
- **Can't tell**: no check you could run here would separate the two; say what would, and what it
  would cost.

Give the command and its output (secrets replaced with `<REDACTED>`) under the verdict. A check
that costs money or touches anything outside this machine is proposed with its cost, never run
unasked.
