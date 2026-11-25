# CodeRabbit Feedback Vetting

Judge every CodeRabbit finding against the repo's intent before acting on it.

## What to check

1. **Architectural intent**: does the suggestion fit the architecture this repo's documents
   describe?
2. **Design decisions**: does it keep the boundaries and policies the ADRs set?
3. **Earlier rulings**: did an earlier round reject or defer the same thing, and does its
   reason still hold?

A finding that cites the wrong file or rule is not wrong for that alone: the rule may live in
another document, so find it before ruling. Fixing a finding another way than CodeRabbit
suggests is still an accept. A finding's explanation can be wrong while the defect it names is
real: rule on the defect, and fix it where the code shows it.

## When a finding conflicts with the design

Record in the `.resolved` how the suggestion conflicts with the design and why making it would
cause a regression or drift. The one-line reason is also the reply on the finding's thread,
where CodeRabbit reads it. Nothing is written into the code.

## When a finding is deferred

Record its target (a phase, milestone or issue) and a one-sentence reason in the `.resolved`,
so a later pass picks it up. The code is unchanged.
