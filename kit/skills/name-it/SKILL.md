---
name: name-it
description: Pins the project's terms down in GLOSSARY.md as they settle, and records hard-to-reverse decisions as ADRs. Use when terms need pinning or the user wants the glossary or an ADR written.
disable-model-invocation: true
---

# Name it

Built from Matt Pocock's `domain-modeling` (mattpocock/skills v1.3.1, MIT); see Credits in the
kit's README for what changed and why.

This skill changes the domain model. Reading `GLOSSARY.md` for vocabulary is a habit every skill
has; this one challenges terms, invents edge cases, and writes the glossary and decisions down
the moment they settle. `/odyssey:grill-me` follows it whenever the repo has a glossary or ADRs.

## Where the files live

- One context (most repos): `GLOSSARY.md` at the root, ADRs in `docs/adr/`.
- Several contexts: `GLOSSARY-MAP.md` at the root points to each context's own `GLOSSARY.md` and
  `docs/adr/`; repo-wide decisions stay in the root `docs/adr/`. Infer which context the topic
  belongs to; ask when it's unclear.

Create a file only when there is something to write in it: `GLOSSARY.md` when the first term is
resolved, `docs/adr/` when the first ADR is needed. The formats are in `formats.md` beside this
file.

## While you design

- **Challenge against the glossary.** A term the user uses differently from `GLOSSARY.md` is
  called out at once: "The glossary defines cancellation as X, but you seem to mean Y. Which is
  it?"
- **Sharpen fuzzy words.** For a vague or overloaded term, propose one precise term: "By account,
  do you mean the Customer or the User? Those are different things."
- **Test with concrete scenarios.** Invent edge cases that force the boundary between two
  concepts into the open.
- **Check the code.** When the user says how something works, read whether the code agrees, and
  name a contradiction: "The code cancels whole Orders, but you said partial cancellation is
  possible. Which is right?"
- **Write a term the moment it settles**, never in a batch at the end. The glossary holds
  definitions only: no implementation details, no decisions, no notes.
- **Offer an ADR only when all three hold:** the decision is hard to reverse, a future reader
  would be surprised by it without context, and it came from a real trade-off between
  alternatives. Missing any one, skip it.

## How the rest of the kit uses these files

- The gate's docs stage checks that the ADRs `GLOSSARY.md` and the instruction files cite exist.
- A rejected design from `/odyssey:grill-me` becomes an ADR here when it meets the three tests
  above, so nobody proposes it again without its reason.
