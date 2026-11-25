import assert from "node:assert/strict";
import test from "node:test";
import { allocate } from "../src/allocate.js";
import { splitByShares, splitEvenly } from "../src/split.js";

test("allocate splits in proportion, and the parts add up to the amount", () => {
  assert.deepEqual(allocate(1000, [1, 1, 1]), [334, 333, 333]);
  assert.deepEqual(allocate(1000, [2400, 1300]), [649, 351]);
  assert.deepEqual(allocate(-500, [1, 1]), [-250, -250]);
  assert.deepEqual(allocate(0, [0, 0]), [0, 0]);
});

test("allocate refuses what it can't split", () => {
  assert.throws(() => allocate(10.5, [1]), /whole number/);
  assert.throws(() => allocate(10, []), /nothing/);
  assert.throws(() => allocate(10, [0, 0]), /zero/);
});

test("a payment splits evenly or by shares, to the cent", () => {
  assert.deepEqual(splitEvenly(4595, 2), [2298, 2297]);
  assert.deepEqual(splitByShares(4595, { gift: 1, card: 3 }), { gift: 1149, card: 3446 });
  assert.throws(() => splitEvenly(4595, 0), /0 parts/);
});
