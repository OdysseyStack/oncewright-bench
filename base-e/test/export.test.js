import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { exportCsv, exportRow } from "../src/export.js";

const at = (p) => fileURLToPath(new URL(p, import.meta.url));

test("one row per order, with its options", () => {
  const order = { id: "A-1", date: "2026-09-01", code: "TAKE5", items: [{ sku: "A", name: "A", unitPrice: 2400, qty: 1 }] };
  assert.equal(exportRow(order), "A-1,2026-09-01,$24.00,$5.00,$5.99,$1.52,$26.51");
  assert.equal(exportCsv([order]).split("\n")[0], "id,date,subtotal,discount,shipping,tax,total");
});

test("export-orders writes the CSV for a folder of orders", () => {
  const r = spawnSync(process.execPath, [at("../bin/export-orders.js"), at("../examples/orders")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    r.stdout,
    "id,date,subtotal,discount,shipping,tax,total\nA-1041,2026-09-02,$60.00,$6.00,$0.00,$4.32,$58.32\nA-1042,2026-09-02,$45.00,$0.00,$0.00,$3.60,$48.60\n",
  );
});
