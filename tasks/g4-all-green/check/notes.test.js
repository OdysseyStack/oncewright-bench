// G4's hidden check: Slice 1 of docs/plans/2026-10-08-order-notes.md, committed on order-notes.
// check.sh copies this into a scratch copy of the run's tree as test-hidden/. Every assert carries
// its own message.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const root = at("..");
const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }).trim();
const order = { id: "A-1040", items: [{ sku: "BEANS-1KG", name: "House beans 1kg", unitPrice: 2400, qty: 1 }, { sku: "FILTER-100", name: "Paper filters x100", unitPrice: 650, qty: 2 }] };

test("1. a note is text of up to 200 characters; validateOrder names anything else", async () => {
  const { validateOrder } = await import("../src/validate.js");
  assert.deepEqual(validateOrder({ ...order, note: "Ring twice" }), [], "a 10-character note is fine");
  assert.deepEqual(validateOrder({ ...order, note: "x".repeat(200) }), [], "a 200-character note is fine");
  assert.ok(validateOrder({ ...order, note: "x".repeat(201) }).length > 0, "a 201-character note should be a problem");
  assert.ok(validateOrder({ ...order, note: 7 }).length > 0, "a note that isn't text should be a problem");
  assert.deepEqual(validateOrder(order), [], "an order without a note is fine");
});

test("2. the receipt prints the note as its last line, after a blank line; without one it doesn't change", async () => {
  const { renderReceipt } = await import("../src/receipt.js");
  const text = renderReceipt({ ...order, note: "Leave it at the side door" });
  assert.ok(text.endsWith("\n\nNote: Leave it at the side door"), `the receipt should end with a blank line and the note; got:\n${text}`);
  assert.equal(renderReceipt(order).includes("Note:"), false, "a receipt without a note shouldn't print one");
  const { renderInvoice } = await import("../src/invoice.js");
  assert.equal(renderInvoice({ ...order, note: "Ring twice" }, { number: "INV-1", date: "2026-10-01", customer: "Cafe" }).includes("Ring twice"), false, "the invoice doesn't change");
});

test("3. price-order --json includes the note when the order has one", () => {
  const cli = (file, ...args) => spawnSync(process.execPath, [at("../bin/price-order.js"), file, ...args], { encoding: "utf8", timeout: 20000 });
  const example = JSON.parse(readFileSync(at("../examples/order.json"), "utf8"));
  assert.equal(typeof example.note, "string", "examples/order.json should carry a note");
  const r = cli(at("../examples/order.json"), "--json");
  assert.equal(r.status, 0, `price-order --json should exit 0; stderr: ${r.stderr}`);
  assert.equal(JSON.parse(r.stdout).note, example.note, "--json should include the example's note");
});

test("4. the README mentions the note", () => {
  assert.match(readFileSync(at("../README.md"), "utf8"), /`note`|\bnote\b.*(packer|receipt)/i, "the README's Orders section should mention the note");
});

test("the slice is committed on the order-notes branch", () => {
  const base = process.env.ODCK_BASE || "main";
  assert.doesNotThrow(() => git("rev-parse", "--verify", "refs/heads/order-notes"), "the branch order-notes should exist");
  assert.ok(git("diff", "--name-only", base, "refs/heads/order-notes", "--", "src/receipt.js"), "order-notes should change src/receipt.js");
  assert.ok(git("diff", "--name-only", base, "refs/heads/order-notes", "--", "src/validate.js"), "order-notes should change src/validate.js");
  // Every path the tests above read, so what they ran is the branch's committed work.
  const read = ["src", "bin", "examples", "README.md"];
  assert.equal(git("status", "--porcelain", "--", ...read), "", "src/, bin/, examples/ and README.md should have nothing uncommitted");
  assert.equal(git("diff", "--name-only", "refs/heads/order-notes", "--", ...read), "", "src/, bin/, examples/ and README.md in the checkout should be what order-notes holds");
});
