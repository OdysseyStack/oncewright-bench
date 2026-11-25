// The plain-text receipt in the order confirmation email.
// Slice 1 of the receipt plan: every amount sits in one right-aligned column.
import { formatMoney } from "./money.js";
import { computeTotals, lineTotal } from "./totals.js";

// Lays out [label, cents] rows: labels on the left, amounts right-aligned in one column, so every
// row is as wide as the widest. A null row is a blank line.
function layout(rows) {
  const cells = rows.map((row) => row && [row[0], formatMoney(row[1])]);
  const labelWidth = Math.max(...cells.filter(Boolean).map(([label]) => label.length));
  const amountWidth = Math.max(...cells.filter(Boolean).map(([, amount]) => amount.length));
  return cells.map((cell) => (cell ? `${cell[0].padEnd(labelWidth)}  ${cell[1].padStart(amountWidth)}` : "")).join("\n");
}

// options: the same options computeTotals takes (pickup, code).
export function renderReceipt(order, options = {}) {
  const totals = computeTotals(order, options);
  return layout([
    ...order.items.map((item) => [`${item.qty} x ${item.name} @ ${formatMoney(item.unitPrice)}`, lineTotal(item)]),
    null,
    ["Subtotal", totals.subtotal],
    ...(totals.code ? [[`Discount (${totals.code})`, -totals.discount]] : []),
    ["Shipping", totals.shipping],
    ["Tax", totals.tax],
    ["Total", totals.total],
  ]);
}
