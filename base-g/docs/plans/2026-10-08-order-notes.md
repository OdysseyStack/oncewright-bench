# Order notes

Status: Slice 1 is next.
Owner: Sam Lee. Written 2026-10-08.

## Why

Customers type delivery instructions into the order comment box ("leave it at the side door",
"ring twice") and the packers never see them: the comment stays in the shop's database and the
receipt, which is what gets printed and taped to the box, doesn't carry it.

Work on the `order-notes` branch.

## Slice 1: the note on the receipt

1. An order file may carry `note`, a string of up to 200 characters. `validateOrder` names a note
   that isn't a string or is longer than that.
2. The receipt prints `Note: <the note>` as its last line, after a blank line, when the order has
   one. Without a note the receipt doesn't change. The invoice doesn't change either.
3. `price-order --json` includes `note` when the order has one.
4. `examples/order.json` gets a note, the README's Orders section mentions it, and the tests cover
   each point above.

Done when `npm run check` passes and each point above holds.
