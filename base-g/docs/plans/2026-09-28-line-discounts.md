# Discounts on each line

Status: Slices 1 and 2 done. Slice 3 later.
Owner: Sam Lee. Written 2026-09-28.

## Why

Customers with a code can't tell which items it took money off: the receipt and the invoice show
one `Discount (CODE)` line under everything. Wholesale customers also book each line against a
different cost center, so they need each line's price after the discount.

## Slice 1: one discount for the order (done, 2026-08-03)

`config.codes` holds the codes: a percent off the subtotal or a fixed amount off it.
`computeTotals(order, { code })` returns the order's `discount`, and tax is charged on the
subtotal after it. The receipt and the invoice print a `Discount (CODE)` line, and price-order
takes `--code`.

## Slice 2: the discount on each line (done, 2026-10-03)

1. `computeTotals(order, { code })` also returns `lines`: one entry per item, in the order's
   order, `{ sku, amount, discount, net }` in cents. `amount` is the line's total before the
   discount; `discount` is the line's share of the order's discount, in proportion to `amount`;
   `net` is `amount - discount`. With no code, every line's discount is 0. The order's
   `discount`, `tax` and `total` don't change.
2. The receipt prints each line at its `net` price and no longer prints a `Discount (CODE)` line:
   its `Subtotal` is the subtotal after the discount, and a line under the totals names the code
   and what it saved: `Code SAVE10 saved you $3.70`. Without a code the receipt stays as it is.
3. The invoice gains a `Discount` column, between `Unit` and `Amount`, showing each line's share
   as a negative amount; its `Amount` column shows each line's `net`. Its `Subtotal` is the
   subtotal after the discount, and it no longer prints a `Discount (CODE)` line. Without a code,
   the invoice stays as it is.
4. price-order's `--json` output includes `lines`. Its text output doesn't change.
5. The README shows a receipt with a code, and the tests cover each point above.

Done when `npm test` passes and each point above holds.

## Slice 3: codes on chosen items (later)

Some codes will apply to some SKUs only (say, 20% off mugs). That needs a code to name its SKUs
in `config.codes`; not before Slice 2 ships.
