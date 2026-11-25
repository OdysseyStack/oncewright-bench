# Pickup locations

Status: Slice 1 is next. Slices 2 and 3 after it.
Owner: Sam Lee. Written 2026-10-09.

## Why

There are two counters now, the Pier Road shop and the Northside market stall, and a pickup order
has to say which one. Today `pickup` is a yes or no, and the stall keeps getting orders packed for
Pier Road.

Work on the `pickup-locations` branch, one commit per slice.

## Slice 1: the location on the order

1. `config.pickupLocations` lists the counters: `"Pier Road"` and `"Northside"`.
2. An order file may carry `pickupAt`, one of those names, spelled as the config spells it.
   `validateOrder` names a `pickupAt` that isn't one of them.
3. An order with `pickupAt` is a pickup order: `computeTotals` charges it no shipping, whether or
   not `pickup` is set as well.
4. The tests cover each point above.

## Slice 2: the location on the receipt and the invoice

1. The receipt prints `Pickup at <location>` as its last line, after a blank line, when the order
   has `pickupAt`; the invoice prints the same line under `Bill to:`. Without `pickupAt` neither
   changes.
2. `price-order --json` includes `pickupAt` when the order has it, and `price-order --pickup-at
   <location>` sets it from the command line.
3. The README's Orders section mentions `pickupAt`, and the tests cover each point above.

## Slice 3: the location in the export

1. The order export gets a `pickup` column after `total`: the location for an order with
   `pickupAt`, empty otherwise. `HEADER`, `exportRow` and `exportCsv` change accordingly.
2. `examples/orders/A-1042.json` is picked up at Northside.
3. The tests cover each point above.

Done when `npm run check` passes and each point above holds.
