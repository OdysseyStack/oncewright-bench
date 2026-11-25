#!/usr/bin/env node
// refund-order: print the refund note for an order (the refund plan's Slice 1: the whole order).
import { parseArgs } from "node:util";
import { loadOrder } from "../src/validate.js";
import { refundFor, renderRefundNote } from "../src/refunds.js";

const usage = "Usage: refund-order <order.json> [--json] [--pickup] [--code <CODE>]";
let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: { json: { type: "boolean" }, pickup: { type: "boolean" }, code: { type: "string" } },
  });
} catch (err) {
  console.error(`refund-order: ${err.message}\n${usage}`);
  process.exit(1);
}
const [file] = args.positionals;
if (!file) {
  console.error(usage);
  process.exit(1);
}

const { order, error } = loadOrder(file);
if (error) {
  console.error(`refund-order: ${error}`);
  process.exit(1);
}

const options = { pickup: args.values.pickup, code: args.values.code };
try {
  console.log(args.values.json ? JSON.stringify(refundFor(order, options)) : renderRefundNote(order, options));
} catch (err) {
  console.error(`refund-order: ${err.message}`);
  process.exit(1);
}
