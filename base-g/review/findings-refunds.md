# CodeRabbit's findings on the refunds work

Pasted from `coderabbit review --prompt-only` on the branch that became the commit "Refund some
lines, with a restocking fee for opened items". Three findings.

============================================================================
File: src/refunds.js
Line: 22
Type: potential_issue

Prompt for AI Agent:
In src/refunds.js around line 22, the tax on a partial refund is computed per line and then
summed: `sumCents(lines.map((item) => percentOf(lineTotal(item), config.taxRate)))`. `percentOf`
drops fractions of a cent, so each line can lose up to a cent and the refund's tax comes out below
what the order charged for those lines (for lines of $6.19 and $10.19 the order charged $1.31 on
them; this refunds $1.30). The plan (docs/plans/2026-09-30-refunds.md, Slice 2 point 1) says the
tax is `percentOf` their summed amount, as `computeTotals` charges it. Compute
`percentOf(items, config.taxRate)` on the summed amount instead, and add a test with amounts where
the two differ.
============================================================================

============================================================================
File: src/refunds.js
Line: 34-38
Type: refactor_suggestion

Prompt for AI Agent:
In src/refunds.js around lines 34 to 38, the refund note shows `Items` as the gross amount of the
refunded lines and then a separate negative `Restocking fee` row, so the customer has to do the
subtraction to see what they get back for the goods. Show the amount after the fee as `Items`
(items - fee) and drop the `Restocking fee` row; keep the fee in the `--json` output for support.
Update the note test accordingly.
============================================================================

============================================================================
File: src/refunds.js
Line: 7
Type: nitpick

Prompt for AI Agent:
In src/refunds.js at line 7, `linesFor` filters with `skus.includes(item.sku)`, which is O(n*m).
Build a `Set` from `skus` once and test membership with `has`. Minor, since orders are short.
============================================================================
