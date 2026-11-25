// The accounting export: one CSV row per order, which the bookkeeper's import reads every night.
// The import splits each row on commas (it doesn't understand quotes) and reads amounts the way
// formatMoney writes them.
import { formatMoney } from "./money.js";
import { computeTotals } from "./totals.js";

export const HEADER = "id,date,subtotal,discount,shipping,tax,total";

// An order file may carry the options it was priced with: { code, pickup }.
export function exportRow(order) {
  const t = computeTotals(order, { code: order.code, pickup: order.pickup });
  return [order.id, order.date, ...[t.subtotal, t.discount, t.shipping, t.tax, t.total].map(formatMoney)].join(",");
}

export function exportCsv(orders) {
  return [HEADER, ...orders.map(exportRow)].join("\n") + "\n";
}
