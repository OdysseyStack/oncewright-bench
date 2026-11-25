import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { refundFor, renderRefundNote } from "../src/refunds.js";

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const order = {
  id: "A-1040",
  items: [
    { sku: "BEANS-1KG", name: "House beans 1kg", unitPrice: 2400, qty: 1 },
    { sku: "FILTER-100", name: "Paper filters x100", unitPrice: 650, qty: 2 },
  ],
};

test("a refund pays back the whole order", () => {
  assert.deepEqual(refundFor(order), { items: 3700, shipping: 599, tax: 296, total: 4595 });
  assert.deepEqual(refundFor(order, { code: "SAVE10" }), { items: 3330, shipping: 599, tax: 266, total: 4195 });
});

test("the refund note shows each part", () => {
  assert.equal(renderRefundNote(order), "Refund for order A-1040\n\nItems    $37.00\nShipping  $5.99\nTax       $2.96\nRefund   $45.95");
});

test("refund-order prints the note, or --json the amounts", () => {
  const cli = (...args) => spawnSync(process.execPath, [at("../bin/refund-order.js"), ...args], { encoding: "utf8" });
  assert.match(cli(at("../examples/order.json")).stdout, /^Refund +\$45\.95$/m);
  assert.deepEqual(JSON.parse(cli(at("../examples/order.json"), "--json").stdout), { items: 3700, shipping: 599, tax: 296, total: 4595 });
  assert.equal(cli().status, 1);
});
