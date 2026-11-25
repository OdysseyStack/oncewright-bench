#!/usr/bin/env node
// price-order: price an order file from the command line.
import { parseArgs } from "node:util";
import { loadOrder } from "../src/validate.js";
import { formatMoney } from "../src/money.js";
import { computeTotals } from "../src/totals.js";

const usage = "Usage: price-order <order.json> [--json] [--pickup] [--code <CODE>]";
let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: { json: { type: "boolean" }, pickup: { type: "boolean" }, code: { type: "string" } },
  });
} catch (err) {
  console.error(`price-order: ${err.message}\n${usage}`);
  process.exit(1);
}
const [file] = args.positionals;
if (!file) {
  console.error(usage);
  process.exit(1);
}

const { order, error } = loadOrder(file);
if (error) {
  console.error(`price-order: ${error}`);
  process.exit(1);
}

let t;
try {
  t = computeTotals(order, { pickup: args.values.pickup, code: args.values.code });
} catch (err) {
  console.error(`price-order: ${err.message}`);
  process.exit(1);
}
if (args.values.json) {
  console.log(JSON.stringify(t));
} else {
  console.log(`Subtotal: ${formatMoney(t.subtotal)}`);
  if (t.code) console.log(`Discount (${t.code}): ${formatMoney(-t.discount)}`);
  console.log(`Shipping: ${formatMoney(t.shipping)}`);
  console.log(`Tax: ${formatMoney(t.tax)}`);
  console.log(`Total: ${formatMoney(t.total)}`);
}
