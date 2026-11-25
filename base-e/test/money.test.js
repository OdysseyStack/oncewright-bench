import assert from "node:assert/strict";
import test from "node:test";
import { formatMoney, percentOf, sumCents } from "../src/money.js";

test("formatMoney prints dollars and two-digit cents", () => {
  assert.equal(formatMoney(4595), "$45.95");
  assert.equal(formatMoney(505), "$5.05");
  assert.equal(formatMoney(0), "$0.00");
  assert.equal(formatMoney(-370), "-$3.70");
});

test("percentOf takes a fraction of an amount", () => {
  assert.equal(percentOf(3700, 0.08), 296);
  assert.equal(percentOf(5000, 0.25), 1250);
  assert.equal(percentOf(0, 0.08), 0);
});

test("sumCents adds amounts", () => {
  assert.equal(sumCents([2400, 1300]), 3700);
  assert.equal(sumCents([]), 0);
});
