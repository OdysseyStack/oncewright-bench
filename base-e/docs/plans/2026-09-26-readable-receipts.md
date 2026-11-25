# Readable receipts

Status: Slice 1 done. Slice 2 is next. Slice 3 waits for the EU shop.
Owner: Sam Lee. Written 2026-09-26.

## Why

Wholesale cafes now place orders over $1,000. Their receipts and invoices print amounts like
`$12480.00`, and support keeps getting calls from people who misread them by a factor of ten.

## Slice 1: amounts in one column (done, 2026-08-25)

The receipt right-aligns every amount in one column, as wide as its widest amount, so the
digits line up.

## Slice 2: group thousands

1. On the receipt, the invoice and price-order's text output, amounts of $1,000.00 and more
   group their thousands with commas: `$12,480.00`, `$1,250,000.00`. Amounts under $1,000.00
   print as they do today.
2. A negative amount keeps its minus sign in front of the dollar sign: `-$1,250.00`.
3. The receipt's amounts stay right-aligned in one column, and the invoice's columns stay
   aligned, however wide the amounts get.
4. The README shows a grouped amount, and the tests cover each point above.

Done when `npm test` passes and each point above holds.

## Slice 3: other currencies (later)

The EU shop opens next year. Euro amounts print as `1.234,50 €`. Nothing in this slice before
then.
