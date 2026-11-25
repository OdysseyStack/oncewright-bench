# Deepening, and designing it twice

Built from Matt Pocock's `codebase-design` guides (mattpocock/skills v1.3.1, MIT). The words are
the ones in `SKILL.md` beside this file.

## Dependencies decide how the deepened module is tested

1. **In-process** (pure computation, in-memory state, no I/O): merge the modules and test through
   the new interface directly. No adapter.
2. **Local stand-in exists** (an in-memory database, an in-memory filesystem): test with the
   stand-in in the suite. The seam stays internal.
3. **Remote but yours** (your own services over a network): define a port at the seam; the deep
   module owns the logic, the transport is an adapter. Tests use an in-memory adapter, production
   an HTTP or queue one.
4. **Truly external** (a payment provider, an SMS gateway): the module takes it as an injected
   port, and tests pass a mock adapter.

Seam discipline: don't add a port without at least two adapters (usually production and test),
and don't expose an internal seam through the interface just because a test uses it.

Tests: replace, don't layer. Once tests at the deepened interface exist, the old tests on the
shallow modules are waste; delete them. Assert outcomes through the interface, never internal
state; a test that must change when the implementation changes is testing past the interface.

## Design it twice

Your first interface is rarely the best (Ousterhout). To explore alternatives for one candidate:

1. **Frame the problem** for the user: the constraints any interface must meet, the dependencies
   and their category above, and a rough code sketch that makes the constraints concrete (not a
   proposal). Show it, then go straight on.
2. **Start three or more subagents in parallel**, each with the same technical brief (file paths,
   coupling, dependency category, what sits behind the seam, the words from `SKILL.md` and the
   glossary) and a different constraint:
   - "Minimise the interface: one to three entry points, the most leverage per entry point."
   - "Maximise flexibility: many uses, room to extend."
   - "Make the most common caller's case trivial."
   - When dependencies cross a seam: "Design around ports and adapters."

   Each returns the interface (types, invariants, ordering, error modes), a caller's usage, what
   it hides, its dependency strategy, and its trade-offs.
3. **Compare** the designs one after another, then by depth, locality and seam placement. Give
   your own recommendation, a hybrid if parts combine well. Be opinionated: the user wants a
   strong read, not a menu. The designs not chosen are recorded as `SKILL.md` says.
