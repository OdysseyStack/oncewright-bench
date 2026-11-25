// Refunds (the refund plan's Slice 1: a whole order at once).
import { formatMoney } from "./money.js";
import { computeTotals } from "./totals.js";

// What a refund pays back, in cents: { items, shipping, tax, total }. items is what the items cost
// after any discount. options: the options the order was priced with (pickup, code).
export function refundFor(order, options = {}) {
  const t = computeTotals(order, options);
  return { items: t.subtotal - t.discount, shipping: t.shipping, tax: t.tax, total: t.total };
}

// The note the customer gets with a refund.
export function renderRefundNote(order, options = {}) {
  const r = refundFor(order, options);
  const rows = [
    ["Items", r.items],
    ["Shipping", r.shipping],
    ["Tax", r.tax],
    ["Refund", r.total],
  ].map(([label, cents]) => [label, formatMoney(cents)]);
  const width = Math.max(...rows.map(([label, amount]) => label.length + amount.length)) + 2;
  return [`Refund for order ${order.id ?? "(no id)"}`, "", ...rows.map(([label, amount]) => label + amount.padStart(width - label.length))].join("\n");
}
