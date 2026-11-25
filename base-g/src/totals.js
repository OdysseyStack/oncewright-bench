// Order totals. An order is { id?, date?, customer?, items: [{ sku, name, unitPrice, qty }] }, prices in cents.
// FIXME: refactor: computeTotals has grown an option per feature.
import { allocate } from "./allocate.js";
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
// Returns { subtotal, discount, code, shipping, tax, total, lines } in cents; code is the code in
// capitals, or null. lines: one { sku, amount, discount, net } per item, where discount is the line's
// share of the order's discount, in proportion to its amount; allocate() makes the shares add up to it.
export function computeTotals(order, options = {}) {
  const amounts = order.items.map(lineTotal);
  const subtotal = sumCents(amounts);
  const discount = discountFor(subtotal, options.code);
  const code = options.code === undefined ? null : findCode(options.code).code;
  const shipping = shippingFor(subtotal, options);
  const tax = percentOf(subtotal - discount, config.taxRate);
  const shares = discount === 0 ? amounts.map(() => 0) : allocate(discount, amounts);
  const lines = order.items.map((item, i) => ({ sku: item.sku, amount: amounts[i], discount: shares[i], net: amounts[i] - shares[i] }));
  return { subtotal, discount, code, shipping, tax, total: subtotal - discount + shipping + tax, lines };
}
