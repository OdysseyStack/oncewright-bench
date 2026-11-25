---
name: shape-it
description: Vocabulary and method for shaping modules (depth, interface, seam, adapter) and designing an interface several ways. Use to design a module's interface, place a seam, or make code easier to test.
disable-model-invocation: true
---

# Shape it

Built from Matt Pocock's `codebase-design` (mattpocock/skills v1.3.1, MIT); see Credits in the
kit's README for what changed and why.

Design **deep modules**: a lot of behaviour behind a small interface, at a clean seam, tested
through that interface. `/odyssey:prove-it` and `/odyssey:untangle` read this file for its words.

## The words

Use these exactly; don't swap in "component", "service", "API" or "boundary".

- **Module**: anything with an interface and an implementation, at any scale: a function, a
  class, a package, a slice across tiers.
- **Interface**: everything a caller must know to use the module correctly: the types, and also
  its invariants, ordering rules, error modes, required configuration and performance.
- **Implementation**: the code inside a module.
- **Depth**: leverage at the interface, how much behaviour a caller or test reaches per thing it
  has to learn. **Deep**: much behaviour behind a small interface. **Shallow**: an interface
  nearly as complex as what it hides.
- **Seam** (Michael Feathers): a place where behaviour can change without editing that place;
  where an interface lives. Where to put it is its own decision.
- **Adapter**: a concrete thing that fills an interface at a seam.
- **Leverage**: what callers get from depth: more capability per thing learned.
- **Locality**: what maintainers get from depth: change, bugs and checks concentrate in one place.

## Principles

- **Depth belongs to the interface.** A deep module can be built from small parts inside; they
  just aren't part of its interface. It can have internal seams for its own tests as well as the
  external one.
- **The deletion test.** Imagine deleting the module. If the complexity vanishes, it was a
  pass-through; if it reappears in every caller, it was earning its place.
- **The interface is the test surface.** Callers and tests cross the same seam; wanting to test
  past the interface means the module is the wrong shape.
- **One adapter is a hypothetical seam; two make it real.** Don't add a seam until something
  actually varies across it.

To make an interface easy to test: accept dependencies instead of creating them, return results
instead of producing side effects, and keep the surface small.

## Rejected designs are recorded

A design you and the user considered and turned down goes into the plan's decisions with its
reason, and into an ADR when `/odyssey:name-it`'s three tests hold, so it isn't proposed again without that reason.

## Going deeper

`deepening.md` beside this file covers deepening a cluster of shallow modules given its
dependencies, and designing an interface several radically different ways before choosing one.
