// Refunds: a whole order (the refund plan's Slice 1), or some of its lines (Slice 2).
import { config } from "./config.js";
import { formatMoney, percentOf, sumCents } from "./money.js";
import { computeTotals, lineTotal } from "./totals.js";

// The order's lines a refund covers: those whose SKUs are listed, or all of them.
const linesFor = (order, skus) => (skus === undefined ? order.items : order.items.filter((item) => skus.includes(item.sku)));

// What a refund pays back, in cents: { items, fee, shipping, tax, total }. options: the options the
// order was priced with (pickup, code), plus skus, the lines to refund (all of them when absent),
// and opened, the refunded lines that keep a restocking fee.
export function refundFor(order, options = {}) {
  const t = computeTotals(order, options);
  const { skus, opened = [] } = options;
  const unknown = [...(skus ?? []), ...opened].find((sku) => !order.items.some((item) => item.sku === sku));
  if (unknown !== undefined) throw new Error(`SKU not on the order: ${unknown}`);
  const lines = linesFor(order, skus);
  const whole = lines.length === order.items.length;
  if (!whole && t.code) throw new Error("Partial refunds of discounted orders aren't supported yet");
  const fee = sumCents(lines.filter((item) => opened.includes(item.sku)).map((item) => percentOf(lineTotal(item), config.restockingFee)));
  const items = whole ? t.subtotal - t.discount : sumCents(lines.map(lineTotal));
  const tax = whole ? t.tax : sumCents(lines.map((item) => percentOf(lineTotal(item), config.taxRate)));
  const shipping = whole ? t.shipping : 0;
  return { items, fee, shipping, tax, total: items - fee + shipping + tax };
}

// The note the customer gets with a refund: the refunded lines, then the totals.
export function renderRefundNote(order, options = {}) {
  const r = refundFor(order, options);
  const rows = [
    ...linesFor(order, options.skus).map((item) => [`${item.qty} x ${item.name}`, lineTotal(item)]),
    null,
    ...(r.fee ? [["Restocking fee", -r.fee]] : []),
    ["Items", r.items],
    ["Shipping", r.shipping],
    ["Tax", r.tax],
    ["Refund", r.total],
  ].map((row) => row && [row[0], formatMoney(row[1])]);
  const width = Math.max(...rows.filter(Boolean).map(([label, amount]) => label.length + amount.length)) + 2;
  return [
    `Refund for order ${order.id ?? "(no id)"}`,
    "",
    ...rows.map((row) => (row ? row[0] + row[1].padStart(width - row[0].length) : "")),
  ].join("\n");
}
