// Order totals. An order is { id?, date?, customer?, items: [{ sku, name, unitPrice, qty }] }, prices in cents.
// FIXME: refactor: computeTotals has grown an option per feature.
import { config } from "./config.js";
import { discountFor, findCode } from "./discounts.js";
import { percentOf, sumCents } from "./money.js";

export function lineTotal(item) {
  return item.unitPrice * item.qty;
}

// options.pickup: the customer collects the order, so there is no shipping.
// The free-shipping threshold looks at the subtotal before any discount.
// TODO: weight-based rates for wholesale (see the old spreadsheet)
export function shippingFor(subtotal, options = {}) {
  if (options.pickup) return 0;
  if (subtotal >= config.shipping.freeOver) return 0;
  return config.shipping.flat;
}

// options.pickup: no shipping. options.code: a discount code from config.codes.
// Returns { subtotal, discount, code, shipping, tax, total } in cents; code is the code in capitals, or null.
export function computeTotals(order, options = {}) {
  const subtotal = sumCents(order.items.map(lineTotal));
  const discount = discountFor(subtotal, options.code);
  const code = options.code === undefined ? null : findCode(options.code).code;
  const shipping = shippingFor(subtotal, options);
  const tax = percentOf(subtotal - discount, config.taxRate);
  return { subtotal, discount, code, shipping, tax, total: subtotal - discount + shipping + tax };
}
