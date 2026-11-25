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
  assert.deepEqual(refundFor(order), { items: 3700, fee: 0, shipping: 599, tax: 296, total: 4595 });
  assert.deepEqual(refundFor(order, { code: "SAVE10" }), { items: 3330, fee: 0, shipping: 599, tax: 266, total: 4195 });
});

test("a refund of some lines pays back their amount and its tax, and no shipping", () => {
  assert.deepEqual(refundFor(order, { skus: ["FILTER-100"] }), { items: 1300, fee: 0, shipping: 0, tax: 104, total: 1404 });
  assert.deepEqual(refundFor(order, { skus: ["FILTER-100", "BEANS-1KG"] }), refundFor(order));
});

test("an opened line keeps a 15% restocking fee", () => {
  assert.deepEqual(refundFor(order, { skus: ["BEANS-1KG"], opened: ["BEANS-1KG"] }), { items: 2400, fee: 360, shipping: 0, tax: 192, total: 2232 });
});

test("a SKU not on the order, or a partial refund of a discounted order, is an error", () => {
  assert.throws(() => refundFor(order, { skus: ["TEA-50"] }), /TEA-50/);
  assert.throws(() => refundFor(order, { skus: ["BEANS-1KG"], code: "SAVE10" }), /discount/);
});

test("the refund note shows each part", () => {
  assert.equal(
    renderRefundNote(order, { skus: ["BEANS-1KG"], opened: ["BEANS-1KG"] }),
    "Refund for order A-1040\n\n1 x House beans 1kg  $24.00\n\nRestocking fee       -$3.60\nItems                $24.00\nShipping              $0.00\nTax                   $1.92\nRefund               $22.32",
  );
});

test("refund-order prints the note, or --json the amounts", () => {
  const cli = (...args) => spawnSync(process.execPath, [at("../bin/refund-order.js"), ...args], { encoding: "utf8" });
  assert.match(cli(at("../examples/order.json")).stdout, /^Refund +\$45\.95$/m);
  assert.deepEqual(JSON.parse(cli(at("../examples/order.json"), "--json").stdout), { items: 3700, fee: 0, shipping: 599, tax: 296, total: 4595 });
  assert.match(cli(at("../examples/order.json"), "--sku", "BEANS-1KG", "--opened", "BEANS-1KG").stdout, /^Restocking fee +-\$3\.60$/m);
  const unknown = cli(at("../examples/order.json"), "--sku", "TEA-50");
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /TEA-50/);
  assert.equal(cli().status, 1);
});
