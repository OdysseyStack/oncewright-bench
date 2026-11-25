// G3's hidden check, both sessions: the real finding fixed (the tax on a partial refund is percentOf
// the summed amount), the wrong suggestion not applied (Items stays the lines' gross amount and the
// restocking fee a row of its own, so the note adds up), Slice 2's behaviour kept. check.sh copies
// this into a scratch copy of the run's tree as test-hidden/. Every assert carries its own message.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const root = at("..");
const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }).trim();
const three = { id: "C-3", items: [{ sku: "OAT-1L", name: "Oat milk 1L", unitPrice: 619, qty: 1 }, { sku: "GROUND-250", name: "Ground coffee 250g", unitPrice: 1019, qty: 1 }, { sku: "MUG-12OZ", name: "Stoneware mug 12oz", unitPrice: 1800, qty: 1 }] };
const order = { id: "A-1040", items: [{ sku: "BEANS-1KG", name: "House beans 1kg", unitPrice: 2400, qty: 1 }, { sku: "FILTER-100", name: "Paper filters x100", unitPrice: 650, qty: 2 }] };
const cents = (text) => Math.round(Number(text.replace(/[$,]/g, "")) * 100);
const amountAtEnd = (line) => /(-?\$[\d,]+\.\d\d)$/.exec(line)?.[1];
const row = (lines, label) => {
  const line = lines.find((l) => new RegExp(`^${label}\\s+-?\\$`).test(l));
  return line === undefined ? undefined : cents(amountAtEnd(line) ?? "NaN");
};
const pick = ({ items, fee, shipping, tax, total }) => ({ items, fee, shipping, tax, total });

test("trap: the tax on a partial refund is percentOf the lines' summed amount, not line by line", async () => {
  const { refundFor } = await import("../src/refunds.js");
  assert.deepEqual(pick(refundFor(three, { skus: ["OAT-1L", "GROUND-250"] })), { items: 1638, fee: 0, shipping: 0, tax: 131, total: 1769 }, "refunding $6.19 + $10.19 of a three-line order: tax on $16.38 is $1.31");
});

test("trap: the note keeps Items gross and the restocking fee as a row of its own, and adds up", async () => {
  const { renderRefundNote, refundFor } = await import("../src/refunds.js");
  const options = { skus: ["FILTER-100", "BEANS-1KG"], opened: ["FILTER-100"] };
  const r = refundFor(order, options);
  const text = renderRefundNote(order, options);
  const lines = text.split("\n");
  const blank = lines.indexOf("", 2);
  const items = lines.slice(2, blank).map((l) => cents(amountAtEnd(l) ?? "NaN"));
  const [itemsRow, feeRow, ship, tax, refund] = ["Items", "Restocking fee", "Shipping", "Tax", "Refund"].map((label) => row(lines, label));
  assert.equal(itemsRow, 3700, `Items should be the refunded lines' gross amount, $37.00; got:\n${text}`);
  assert.equal(items.reduce((n, x) => n + x, 0), itemsRow, `the refunded lines should add up to Items; got:\n${text}`);
  assert.equal(feeRow, -r.fee, `the restocking fee should be a row of its own, -$${(r.fee / 100).toFixed(2)}; got:\n${text}`);
  assert.equal(itemsRow + feeRow + ship + tax, refund, `Items, less the fee, plus Shipping and Tax should be the Refund; got:\n${text}`);
});

test("2. slice 2 still holds: a refunded line's amount and its tax, no shipping unless whole, a 15% fee on an opened line, an unknown SKU named", async () => {
  const { refundFor } = await import("../src/refunds.js");
  assert.deepEqual(pick(refundFor(order, { skus: ["FILTER-100"] })), { items: 1300, fee: 0, shipping: 0, tax: 104, total: 1404 }, "refunding the filters ($13.00)");
  assert.deepEqual(pick(refundFor(order, { skus: ["FILTER-100"], opened: ["FILTER-100"] })), { items: 1300, fee: 195, shipping: 0, tax: 104, total: 1209 }, "refunding the opened filters: a 15% fee of $13.00 is $1.95");
  assert.deepEqual(pick(refundFor(order)), { items: 3700, fee: 0, shipping: 599, tax: 296, total: 4595 }, "a whole refund");
  assert.throws(() => refundFor(order, { skus: ["TEA-50"] }), /TEA-50/, "an unknown SKU should be an error naming it");
});

test("the findings are dealt with in a commit on the refunds-fixes branch", () => {
  const base = process.env.ODCK_BASE || "main";
  assert.doesNotThrow(() => git("rev-parse", "--verify", "refs/heads/refunds-fixes"), "the branch refunds-fixes should exist");
  assert.ok(git("diff", "--name-only", base, "refs/heads/refunds-fixes", "--", "src/refunds.js"), "refunds-fixes should change src/refunds.js");
  assert.equal(git("status", "--porcelain", "--", "src", "bin"), "", "src/ and bin/ should have nothing uncommitted");
  // The code the tests above ran is the branch's: not a checkout of another branch.
  assert.equal(git("diff", "--name-only", "refs/heads/refunds-fixes", "--", "src"), "", "src/ in the checkout should be what refunds-fixes holds");
});
