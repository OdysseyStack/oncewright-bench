import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../bin/price-order.js", import.meta.url));
const example = fileURLToPath(new URL("../examples/order.json", import.meta.url));
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });

test("prints the totals of an order file", () => {
  const { status, stdout } = run(example);
  assert.equal(status, 0);
  assert.equal(stdout, "Subtotal: $37.00\nShipping: $5.99\nTax: $2.96\nTotal: $45.95\n");
});

test("--code shows the discount; --pickup drops the shipping", () => {
  assert.equal(run(example, "--code", "SAVE10").stdout, "Subtotal: $37.00\nDiscount (SAVE10): -$3.70\nShipping: $5.99\nTax: $2.66\nTotal: $41.95\n");
  assert.match(run(example, "--pickup").stdout, /^Shipping: \$0\.00$/m);
});

test("--json prints the totals in cents", () => {
  const t = JSON.parse(run(example, "--json").stdout);
  assert.equal(t.subtotal, 3700);
  assert.equal(t.total, 4595);
});

test("bad input: the usage, an unknown code, a bad order", () => {
  assert.match(run().stderr, /Usage: price-order/);
  const unknown = run(example, "--code", "FREE");
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /FREE/);
  assert.equal(run(fileURLToPath(new URL("../package.json", import.meta.url))).status, 1);
});
