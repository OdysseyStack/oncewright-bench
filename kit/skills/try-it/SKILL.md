---
name: try-it
description: Builds a throwaway prototype that answers one design question, a page driving a state model or several versions of a screen, and records its verdict. Use before building a state model or a UI.
disable-model-invocation: true
---

# Try it

Built from Matt Pocock's `prototype` (mattpocock/skills v1.3.1, MIT); see Credits in the kit's
README for what changed and why.

A prototype is **throwaway code that answers one question**. Write the question down first, in
one line at the top of the prototype; the question decides the shape.

## Where it lives

Never on the main branch, and never pushed. A UI prototype lives on a local branch named
`prototype/<name>`, created after the user's yes; a single-file logic demo can live in the
session's scratchpad instead. Its files are the request's scope, since they never reach the
main branch: the decision it validates is made in the real code afterwards, like any other
change.

## Pick the shape

- **"Does this logic feel right?"** (a state model, a data shape, which actions are legal when):
  one self-contained HTML file, plain HTML, CSS and JavaScript, nothing to install.
  - The logic sits in one `<script>` as a small pure module (a reducer `(state, action) =>
    state`, a state machine, or a few pure functions) with no DOM in it, so it can be lifted into
    the real code later. The page only calls into it.
  - Top to bottom: the title and the question; the current state as a readable panel (labelled
    fields, not raw JSON), redrawn after every click with what changed marked; one button per
    action for free play; and guided scenarios, one per tab, each a short description and the
    buttons to press in order, starting from a reset state. Pick the awkward cases: the happy
    path, a tricky edge, something that should be refused.
  - Labels use the domain's words, not the code's, so someone who doesn't code can drive it.
- **"What should this look like?"**: three variants (five at most) that differ in structure
  (layout, hierarchy, the main action), not in colour.
  - Prefer an existing page: render the variants on its route behind a `?variant=` search
    parameter, keeping its data loading. Only something with no possible home gets a new route,
    named with `prototype` in it, following the project's routing.
  - A small floating bar at the bottom centre switches variants: arrows either side of the
    variant's name, the left and right arrow keys too (except while typing in a field), the URL
    updated so a reload keeps the variant, and hidden in production builds.
  - Read-only: a variant that needs to change data calls a stub.

If the question is unclear and the user isn't there, pick the shape the surrounding code suggests
(a backend module → logic; a page → UI) and say so at the top.

## Rules for both

- **One command to run it**: the file opens by double-click, or the route starts with the
  project's usual dev command.
- **State in memory.** Persistence is what a prototype might be checking, never what it relies
  on; a database question gets a scratch database named so it's obviously disposable.
- **No polish**: no tests, no error handling beyond what keeps it running, no abstractions.
- **Show the state** after every action or variant switch.

## The verdict

When the prototype has answered its question, record the answer where the plan's decisions live:
as a G-line in the plan's `## Grilling record` (see `/odyssey:grill-me`),

```
G<n> — <the question>: <the verdict>. Why: <what the prototype showed>. Prototype: <branch or file>.
```

or, with no plan, in the commit or the note that carries the decision. The decision is then made
in the real code like any other change (the logic module can move across as it is; a winning UI
variant is rewritten properly). The prototype branch stays local as the record of what was tried;
delete it when the user says.
