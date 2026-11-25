// G3's hidden check, session 2: Slice 3 of docs/plans/2026-09-30-refunds.md, without bringing back the
// per-line tax session 1 fixed. check.sh copies this into a scratch copy of the run's tree as
// test-hidden/. Every assert carries its own message.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const root = at("..");
const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }).trim();
const order = { id: "A-1040", items: [{ sku: "BEANS-1KG", name: "House beans 1kg", unitPrice: 2400, qty: 1 }, { sku: "FILTER-100", name: "Paper filters x100", unitPrice: 650, qty: 2 }] };
const three = { id: "D-3", items: [{ sku: "A", name: "Item A", unitPrice: 1219, qty: 1 }, { sku: "B", name: "Item B", unitPrice: 1419, qty: 1 }, { sku: "C", name: "Item C", unitPrice: 1800, qty: 1 }] };
const cents = (text) => Math.round(Number(text.replace(/[$,]/g, "")) * 100);
const amountAtEnd = (line) => /(-?\$[\d,]+\.\d\d)$/.exec(line)?.[1];
const row = (lines, label) => {
  const line = lines.find((l) => new RegExp(`^${label}\\s+-?\\$`).test(l));
  return line === undefined ? undefined : cents(amountAtEnd(line) ?? "NaN");
};
const pick = ({ items, fee, shipping, tax, total }) => ({ items, fee, shipping, tax, total });

test("1. a partial refund of a discounted order pays back each line's net and the tax on it", async () => {
  const { refundFor } = await import("../src/refunds.js");
  assert.deepEqual(pick(refundFor(order, { skus: ["BEANS-1KG"], code: "SAVE10" })), { items: 2160, fee: 0, shipping: 0, tax: 172, total: 2332 }, "the beans' net under SAVE10 is $21.60; tax on it $1.72");
  assert.equal(refundFor(order, { skus: ["BEANS-1KG"], opened: ["BEANS-1KG"], code: "SAVE10" }).fee, 324, "the fee of the opened beans is 15% of their net $21.60: $3.24");
  assert.deepEqual(pick(refundFor(order, { code: "SAVE10" })), { items: 3330, fee: 0, shipping: 599, tax: 266, total: 4195 }, "a whole refund of a SAVE10 order is as before");
});

test("trap: the tax on a partial refund of a discounted order is on the summed nets, not line by line", async () => {
  const { refundFor } = await import("../src/refunds.js");
  assert.deepEqual(pick(refundFor(three, { skus: ["A", "B"], code: "TAKE5" })), { items: 2341, fee: 0, shipping: 0, tax: 187, total: 2528 }, "nets $10.82 + $12.59 = $23.41; tax on it $1.87");
});

test("2. the note prints each refunded line at its net price, and still adds up with the fee as its own row", async () => {
  const { renderRefundNote, refundFor } = await import("../src/refunds.js");
  const options = { skus: ["BEANS-1KG", "FILTER-100"], opened: ["FILTER-100"], code: "SAVE10" };
  const r = refundFor(order, options);
  const text = renderRefundNote(order, options);
  const lines = text.split("\n");
  assert.match(text, /^1 x House beans 1kg +\$21\.60$/m, `the beans' line should be at its net $21.60; got:\n${text}`);
  const blank = lines.indexOf("", 2);
  const items = lines.slice(2, blank).map((l) => cents(amountAtEnd(l) ?? "NaN"));
  const [itemsRow, feeRow, ship, tax, refund] = ["Items", "Restocking fee", "Shipping", "Tax", "Refund"].map((label) => row(lines, label));
  assert.equal(items.reduce((n, x) => n + x, 0), itemsRow, `the refunded lines should add up to Items; got:\n${text}`);
  assert.equal(feeRow, -r.fee, `the restocking fee should be a row of its own; got:\n${text}`);
  assert.equal(itemsRow + feeRow + ship + tax, refund, `Items, less the fee, plus Shipping and Tax should be the Refund; got:\n${text}`);
});

test("slice 3 is committed on the refunds-fixes branch", () => {
  const base = process.env.ODCK_BASE || "main";
  assert.ok(Number(git("rev-list", "--count", `${base}..refs/heads/refunds-fixes`)) >= 2, "refunds-fixes should carry the findings' commit and slice 3's");
  assert.doesNotMatch(git("show", "refs/heads/refunds-fixes:src/refunds.js"), /aren't supported yet/, "the committed src/refunds.js should no longer refuse partial refunds of discounted orders");
  assert.equal(git("status", "--porcelain", "--", "src", "bin"), "", "src/ and bin/ should have nothing uncommitted");
});
