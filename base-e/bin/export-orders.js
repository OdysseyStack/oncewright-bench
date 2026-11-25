#!/usr/bin/env node
// export-orders: the accounting export for every order file in a folder, as CSV on stdout.
import { readdirSync } from "node:fs";
import path from "node:path";
import { exportCsv } from "../src/export.js";
import { loadOrder } from "../src/validate.js";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: export-orders <folder of order files>");
  process.exit(1);
}

const orders = [];
for (const name of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const { order, error } = loadOrder(path.join(dir, name));
  if (error) {
    console.error(`export-orders: ${error}`);
    process.exit(1);
  }
  orders.push(order);
}
process.stdout.write(exportCsv(orders));
