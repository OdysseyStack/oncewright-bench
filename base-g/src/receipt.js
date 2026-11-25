// The plain-text receipt in the order confirmation email.
// Slice 1 of the receipt plan: every amount sits in one right-aligned column.
import { formatMoney } from "./money.js";
import { computeTotals } from "./totals.js";

// Lays out [label, cents] rows: labels on the left, amounts right-aligned in one column, so every
// row is as wide as the widest. A null row is a blank line.
function layout(rows) {
  const cells = rows.map((row) => row && [row[0], formatMoney(row[1])]);
  const labelWidth = Math.max(...cells.filter(Boolean).map(([label]) => label.length));
  const amountWidth = Math.max(...cells.filter(Boolean).map(([, amount]) => amount.length));
  return cells.map((cell) => (cell ? `${cell[0].padEnd(labelWidth)}  ${cell[1].padStart(amountWidth)}` : "")).join("\n");
}

// options: the same options computeTotals takes (pickup, code). With a code, each line shows its
// price after its share of the discount, the Subtotal is after the discount, and a last line says
// what the code saved.
export function renderReceipt(order, options = {}) {
  const totals = computeTotals(order, options);
  const text = layout([
    ...order.items.map((item, i) => [`${item.qty} x ${item.name} @ ${formatMoney(item.unitPrice)}`, totals.lines[i].net]),
    null,
    ["Subtotal", totals.subtotal - totals.discount],
    ["Shipping", totals.shipping],
    ["Tax", totals.tax],
    ["Total", totals.total],
  ]);
  return totals.code ? `${text}\n\nCode ${totals.code} saved you ${formatMoney(totals.discount)}` : text;
}
