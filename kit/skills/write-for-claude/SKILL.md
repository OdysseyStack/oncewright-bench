---
name: write-for-claude
description: How to write files Claude follows (skills, CLAUDE.md, rules, directives) so it takes the same path every run. Use when writing one, or when /odyssey:audit cites one of its rules.
disable-model-invocation: true
---

# Write for Claude

Built from Matt Pocock's `writing-for-agents` (mattpocock/skills v1.3.1, MIT); see Credits in the
kit's README for what changed and why.

Everything here applies to any file Claude reads as instructions: a skill, `CLAUDE.md`, a rule in
`.claude/rules/`, a directive, a doc another file points to. When the file is a skill, also read
`skills.md` beside this file. `/odyssey:audit` cites these rules by their headings.

## Pointers

A **pointer** is a line Claude always has in context that names material it doesn't have yet,
and says when to reach for it: a skill's description, a line in `CLAUDE.md` naming a doc. The
pointer's wording, not the material behind it, decides when Claude reaches it. A must-have file
behind a weak pointer is a bug: sharpen the wording first, and move the material inline only if
that fails. A pointer says what the material is and lists each distinct case that should send
Claude there, once each:

- **Lead with the trigger word**: the first words do the triggering.
- **One trigger per case**: synonyms for one case are one case written twice.
- **Cut what the body already says.**

## The two loads

- **Context load**: what sits in Claude's context every turn (a `CLAUDE.md` line, a skill's
  description), paid whether or not it fires.
- **Cognitive load**: what the person must remember exists. Spend it where their judgment
  matters; remove it where it doesn't.

Material behind a pointer costs only the pointer's line; material with no pointer rides on the
person's memory.

## The ladder

A file holds **steps** (what Claude does, in order) and **reference** (definitions, rules and
facts it consults). Place each piece on a ladder by how soon Claude needs it:

1. steps in the file;
2. reference in the file;
3. reference in another file, behind a pointer, loaded only when needed.

Inline what every path through the file needs; move behind a pointer what only some paths reach.
Keep a concept's definition, rules and caveats under one heading. A file that is simply too long
(**sprawl**) thins Claude's attention even when every line is live: move reference down the
ladder, or split the file by path.

## Steps end on a check

Every step ends on a **completion criterion** that tells Claude it's done:

- **Clear**: Claude can tell done from not done. A vague end ("understanding reached") invites
  stopping early; sharpen it first. Hiding later steps only helps across a real break, a handoff
  or a subagent.
- **Demanding**: "every modified model accounted for" makes Claude dig where "produce a list" does
  not.

The strongest criteria are both checkable and exhaustive.

## When to split

Split one file into two only when the cut earns its cost: a run of steps whose later steps tempt
Claude to rush the current one (keep them out of view), or a part that needs its own invocation
(see `skills.md`).

## Leading words

A **leading word** is a compact idea the model already knows (*tight*, *red*, *tracer bullet*,
*lesson*). Repeated as a word, it anchors a whole behaviour in a few tokens: "fast, deterministic,
low-overhead" becomes a *tight* loop; "a loop you believe in" becomes one that goes *red* on the
bug. Prefer a word the model already knows to one you coin and must define. Look for triads and
long gestures that one word would retire.

## Say the target, not the ban

A prohibition puts the forbidden behaviour into context and makes it more likely. State the
behaviour you want ("write one-line comments"). Keep a ban only as a hard guardrail you can't say
positively, and pair it with the target.

## Pruning

- **One home per meaning**: say each thing in one place, so changing it is one edit.
- **The repo is a source too**: `package.json` scripts, config files, the folder layout and
  `--help` already say what they say. Copy only what Claude can't find by looking: the unwritten
  convention, the reason behind a choice, the trap no config admits.
- **Relevance**: every line still bears on what the file does. Lines go stale; without pruning
  they settle into layers no one dares remove.
- **No-ops**: a sentence Claude would obey anyway costs load and says nothing. Delete the whole
  sentence. A word too weak to beat the default (*be thorough*) is a no-op too; a stronger word
  (*relentless*) fixes it.
