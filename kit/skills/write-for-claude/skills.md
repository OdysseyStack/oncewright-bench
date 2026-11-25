# Writing a skill

Built from Matt Pocock's `writing-for-agents` skill notes (mattpocock/skills v1.3.1, MIT). The
general rules are in `SKILL.md` beside this file.

## Model-invoked or typed: the kit's rule

- **Model-invoked** (no `disable-model-invocation`): Claude can start it on its own, and so can a
  person typing its name. Its `description` sits in every session's context, so it is a pointer
  and follows the pointer rules: the trigger cases, each once.
- **Typed** (`disable-model-invocation: true`): only a person typing its name starts it. Nothing
  sits in context; the person is the index. Its description becomes a one-line summary for
  people. `/odyssey:which-one` is the kit's front door to them: one model-invoked description,
  so Claude can point a person to a typed skill they asked about in plain words.

The kit makes a skill model-invoked only when Claude must reach it unprompted, or another skill
must start it by name. A skill that other kit skills only **read by path** (`../name-it/SKILL.md`)
stays typed: reading a file needs no description. A plain `description:` value never holds `: `
or ` #`, which YAML reads as a mapping or a comment; quote it when it must.

## Splitting by invocation

Split a model-invoked skill off only for a trigger word you actually use that should start it on
its own, or when another skill must start it. Each new description is load in every session.

## Router skills

When typed skills pile up past what a person remembers, one typed skill that names the others and
when to reach for each turns many things to remember into one. It can only point; it can't start
a typed skill.
