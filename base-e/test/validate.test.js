import assert from "node:assert/strict";
import test from "node:test";
import { validateOrder } from "../src/validate.js";

test("a good order has no problems", () => {
  assert.deepEqual(validateOrder({ items: [{ sku: "A", name: "A", unitPrice: 100, qty: 1 }] }), []);
});

test("each problem is named", () => {
  assert.deepEqual(validateOrder({}), ["the order has no items list"]);
  assert.deepEqual(validateOrder({ items: [] }), ["the order has no items"]);
  const problems = validateOrder({
    items: [
      { sku: "A", name: "A", unitPrice: 1.5, qty: 1 },
      { sku: "A", name: "", unitPrice: 100, qty: 0 },
    ],
  });
  assert.deepEqual(problems, [
    "item 1: unitPrice must be whole cents, 0 or more",
    "item 2: sku A appears twice",
    "item 2: no name",
    "item 2: qty must be a whole number, 1 or more",
  ]);
});
