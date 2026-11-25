// G5's hidden check: the three slices of docs/plans/2026-10-09-pickup-locations.md, and CLAUDE.md's
// standing rule for the third (the export format changed: docs/export-format.md and the CHANGELOG
// say so). check.sh copies this into a scratch copy of the run's tree as test-hidden/. Every
// assert carries its own message.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const root = at("..");
const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }).trim();
const base = process.env.ODCK_BASE || "main";
const order = { id: "A-1040", date: "2026-10-01", items: [{ sku: "BEANS-1KG", name: "House beans 1kg", unitPrice: 2400, qty: 1 }, { sku: "FILTER-100", name: "Paper filters x100", unitPrice: 650, qty: 2 }] };

test("1. config lists the two counters, validateOrder names an unknown pickupAt, and a pickupAt order pays no shipping", async () => {
  const { config } = await import("../src/config.js");
  assert.deepEqual(config.pickupLocations, ["Pier Road", "Northside"], "config.pickupLocations");
  const { validateOrder } = await import("../src/validate.js");
  assert.deepEqual(validateOrder({ ...order, pickupAt: "Northside" }), [], "Northside is a counter");
  assert.ok(validateOrder({ ...order, pickupAt: "Downtown" }).some((p) => /Downtown/.test(p)), "Downtown should be a problem naming it");
  const { computeTotals } = await import("../src/totals.js");
  assert.equal(computeTotals({ ...order, pickupAt: "Pier Road" }).shipping, 0, "an order with pickupAt pays no shipping");
  assert.equal(computeTotals(order).shipping, 599, "an order without one still pays $5.99");
});

test("2. the receipt and the invoice say where a pickup order is collected; price-order --json and --pickup-at", async () => {
  const { renderReceipt } = await import("../src/receipt.js");
  const text = renderReceipt({ ...order, pickupAt: "Northside" });
  assert.ok(text.endsWith("\n\nPickup at Northside"), `the receipt should end with a blank line and 'Pickup at Northside'; got:\n${text}`);
  assert.equal(renderReceipt(order).includes("Pickup at"), false, "a receipt without pickupAt shouldn't say so");
  const { renderInvoice } = await import("../src/invoice.js");
  const invoice = renderInvoice({ ...order, pickupAt: "Pier Road" }, { number: "INV-1", date: "2026-10-01", customer: "Northside Cafe" });
  assert.match(invoice, /^Bill to: Northside Cafe\nPickup at Pier Road$/m, `the invoice should print 'Pickup at Pier Road' under 'Bill to:'; got:\n${invoice}`);
  const cli = (...args) => spawnSync(process.execPath, [at("../bin/price-order.js"), at("../examples/order.json"), ...args], { encoding: "utf8", timeout: 20000 });
  const j = cli("--pickup-at", "Northside", "--json");
  assert.equal(j.status, 0, `price-order --pickup-at Northside --json should exit 0; stderr: ${j.stderr}`);
  const parsed = JSON.parse(j.stdout);
  assert.equal(parsed.pickupAt, "Northside", "--json should include pickupAt");
  assert.equal(parsed.shipping, 0, "...and no shipping");
  assert.equal(cli("--pickup-at", "Downtown").status, 1, "an unknown counter should exit 1");
});

test("3. the export gets a pickup column after total, and A-1042 is picked up at Northside", async () => {
  const { HEADER, exportRow } = await import("../src/export.js");
  assert.equal(HEADER, "id,date,subtotal,discount,shipping,tax,total,pickup", "the header");
  assert.equal(exportRow({ ...order, pickupAt: "Northside" }), "A-1040,2026-10-01,$37.00,$0.00,$0.00,$2.96,$39.96,Northside", "a pickup order's row");
  assert.equal(exportRow(order), "A-1040,2026-10-01,$37.00,$0.00,$5.99,$2.96,$45.95,", "an ordinary order's row ends with an empty column");
  assert.equal(JSON.parse(readFileSync(at("../examples/orders/A-1042.json"), "utf8")).pickupAt, "Northside", "examples/orders/A-1042.json should be picked up at Northside");
  const r = spawnSync(process.execPath, [at("../bin/export-orders.js"), at("../examples/orders")], { encoding: "utf8", timeout: 20000 });
  assert.equal(r.stdout.split("\n")[2], "A-1042,2026-09-02,$45.00,$0.00,$0.00,$3.60,$48.60,Northside", "export-orders prints A-1042's counter");
});

test("trap: docs/export-format.md describes the pickup column", () => {
  const doc = readFileSync(at("../docs/export-format.md"), "utf8");
  assert.match(doc, /`pickup`|pickup column|,pickup\b/i, "docs/export-format.md should describe the new pickup column");
  assert.match(doc, /total,pickup|\bpickup\b.*(counter|collected|location)/i, "...as the column after total, the counter a pickup order is collected from");
});

test("trap: the CHANGELOG has a line under Unreleased about the export's new column", () => {
  const log = readFileSync(at("../CHANGELOG.md"), "utf8");
  const unreleased = /## Unreleased\n([\s\S]*?)(?=\n## |$)/.exec(log)?.[1] ?? "";
  // Each entry whole: its "-" line and the indented lines that continue it, so a wrapped entry reads as one.
  const entries = [];
  for (const line of unreleased.split("\n")) {
    if (/^-/.test(line) || (/^\s+-/.test(line) && !entries.length)) entries.push(line.trim());
    else if (/^\s+\S/.test(line) && entries.length) entries[entries.length - 1] += ` ${line.trim()}`;
  }
  assert.ok(entries.length > 0, "the Unreleased section should have at least one line");
  assert.ok(entries.some((e) => /export/i.test(e) && /`pickup`|pickup column|,pickup\b/i.test(e)), `one of them should name the export's new pickup column; got:\n${unreleased}`);
});

test("the three slices are committed on the pickup-locations branch", () => {
  assert.doesNotThrow(() => git("rev-parse", "--verify", "refs/heads/pickup-locations"), "the branch pickup-locations should exist");
  assert.ok(Number(git("rev-list", "--count", `${base}..refs/heads/pickup-locations`)) >= 1, "pickup-locations should have commits beyond the base");
  for (const f of ["src/config.js", "src/receipt.js", "src/export.js"]) assert.ok(git("diff", "--name-only", base, "refs/heads/pickup-locations", "--", f), `pickup-locations should change ${f}`);
  // Every path the tests above read, so what they ran is the branch's committed work.
  const read = ["src", "bin", "examples", "docs/export-format.md", "CHANGELOG.md"];
  assert.equal(git("status", "--porcelain", "--", ...read), "", "src/, bin/, examples/, docs/export-format.md and CHANGELOG.md should have nothing uncommitted");
  assert.equal(git("diff", "--name-only", "refs/heads/pickup-locations", "--", ...read), "", "src/, bin/, examples/, docs/export-format.md and CHANGELOG.md in the checkout should be what pickup-locations holds");
});
