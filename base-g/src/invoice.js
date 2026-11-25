// The invoice for business customers: a table of the lines, then the totals.
import { config } from "./config.js";
import { formatMoney } from "./money.js";
import { computeTotals } from "./totals.js";

// Pads each column to its widest cell: "left" columns pad on the right, the rest on the left.
function table(rows, align) {
  const widths = rows[0].map((_, col) => Math.max(...rows.map((row) => row[col].length)));
  return rows.map((row) =>
    row.map((cell, col) => (align[col] === "left" ? cell.padEnd(widths[col]) : cell.padStart(widths[col]))).join("  ").trimEnd(),
  );
}

// invoice: { number, date, customer }. options: the same options computeTotals takes (pickup, code).
// With a code, a Discount column shows each line's share, the Amount column each line after it, and
// the Subtotal is after the discount.
export function renderInvoice(order, invoice, options = {}) {
  const totals = computeTotals(order, options);
  const b = config.business;
  const coded = totals.code !== null;
  const lines = table(
    [
      ["SKU", "Item", "Qty", "Unit", ...(coded ? ["Discount"] : []), "Amount"],
      ...order.items.map((item, i) => [
        item.sku,
        item.name,
        String(item.qty),
        formatMoney(item.unitPrice),
        ...(coded ? [formatMoney(-totals.lines[i].discount)] : []),
        formatMoney(totals.lines[i].net),
      ]),
    ],
    ["left", "left", "right", "right", "right", "right"],
  );
  const width = Math.max(...lines.map((line) => line.length));
  const sums = [
    ["Subtotal", totals.subtotal - totals.discount],
    ["Shipping", totals.shipping],
    ["Tax", totals.tax],
    ["Total", totals.total],
  ].map(([label, cents]) => label + formatMoney(cents).padStart(width - label.length));
  return [
    `INVOICE ${invoice.number}`,
    `${b.name}, ${b.address}. Tax ID ${b.taxId}`,
    `Date: ${invoice.date}`,
    `Bill to: ${invoice.customer}`,
    "",
    ...lines,
    "",
    ...sums,
  ].join("\n");
}
