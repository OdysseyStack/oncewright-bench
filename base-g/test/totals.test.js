import assert from "node:assert/strict";
import test from "node:test";
import { discountFor, findCode } from "../src/discounts.js";
import { computeTotals, lineTotal } from "../src/totals.js";

const order = (...items) => ({ items: items.map(([unitPrice, qty], i) => ({ sku: `SKU-${i}`, name: "Item", unitPrice, qty })) });

test("a line total is the unit price times the quantity", () => {
  assert.equal(lineTotal({ unitPrice: 650, qty: 2 }), 1300);
});

test("tax is 8% of the subtotal, and small orders pay flat shipping", () => {
  const { lines, ...t } = computeTotals(order([2400, 1], [650, 2]));
  assert.deepEqual(t, { subtotal: 3700, discount: 0, code: null, shipping: 599, tax: 296, total: 4595 });
  assert.deepEqual(lines, [
    { sku: "SKU-0", amount: 2400, discount: 0, net: 2400 },
    { sku: "SKU-1", amount: 1300, discount: 0, net: 1300 },
  ]);
});

test("orders from $50.00 ship free; pickup orders pay no shipping", () => {
  assert.equal(computeTotals(order([2500, 2])).shipping, 0);
  assert.equal(computeTotals(order([4990, 1])).shipping, 599);
  assert.equal(computeTotals(order([1000, 1]), { pickup: true }).total, 1080);
});

test("a code takes money off before tax", () => {
  const { lines, ...t } = computeTotals(order([2400, 1], [650, 2]), { code: "save10" });
  assert.deepEqual(t, { subtotal: 3700, discount: 370, code: "SAVE10", shipping: 599, tax: 266, total: 4195 });
  assert.deepEqual(lines.map((l) => [l.discount, l.net]), [[240, 2160], [130, 1170]]);
  assert.equal(computeTotals(order([2400, 1]), { code: "TAKE5" }).discount, 500);
});

test("each line's share of a discount, and the shares add up to it", () => {
  const { lines, discount } = computeTotals(order([1000, 1], [1000, 1], [1000, 1]), { code: "TAKE5" });
  assert.deepEqual(lines.map((l) => l.discount), [167, 167, 166]);
  assert.equal(lines.reduce((n, l) => n + l.discount, 0), discount);
});

test("codes: any case, never more than the subtotal, an unknown one throws", () => {
  assert.equal(findCode(" staff25 ").code, "STAFF25");
  assert.equal(discountFor(300, "TAKE5"), 300);
  assert.equal(discountFor(3700, undefined), 0);
  assert.throws(() => computeTotals(order([2400, 1]), { code: "FREE" }), /FREE/);
});
