# Ledger export

Status: Slice 1 is next. Slice 2 after it.
Owner: Sam Lee. Written 2026-10-07.

## Why

The bookkeeper is moving from the spreadsheet import to a ledger system. It wants each order's
lines, not only its totals, and it reads JSON, not CSV. The nightly CSV export stays exactly as
it is until the move is done.

Work on the `ledger-export` branch, one commit per slice.

## Slice 1: the lines export

1. `exportLines(orders)` in `src/export.js`: one CSV row per order line, `id,date,sku,qty,unit,amount`,
   the header first, the orders in the order given and each order's lines in its order. `unit` is
   the unit price and `amount` the line's total before any discount, both written as the order
   export writes amounts (`$12.50`).
2. `export-orders <folder> --lines` prints it instead of the order rows.
3. The README's CLI section covers the flag, and the tests cover each point above.

Done when `npm run check` passes and each point above holds.

## Slice 2: the JSON export

1. `exportJson(orders)` in `src/export.js`: a JSON array with one object per order,
   `{ id, date, subtotal, discount, shipping, tax, total, lines }`, where `lines` is a list of
   `{ sku, qty, unit, amount }` as in Slice 1. Amounts in the same form as the CSV writes them
   (`$12.50`), unless the ledger team asks for something else: Sam is checking with them.
2. `export-orders <folder> --json` prints it, indented with two spaces and ending with a newline.
3. The README's CLI section covers the flag, and the tests cover each point above.

Done when `npm run check` passes and each point above holds.
