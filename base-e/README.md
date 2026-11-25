# order-pricing

Prices Harbor Coffee Supply's shop orders in integer cents: discount codes, sales tax, shipping,
the receipt in the order confirmation email, invoices for business customers, refunds, split
payments and the nightly accounting export. No dependencies; Node 22 or later.

## Orders

An order is JSON with a list of items, each price in cents. An order file may also carry its id,
its date, and the options it was priced with (`code`, `pickup`):

```json
{ "id": "A-1041", "date": "2026-09-02", "code": "SAVE10",
  "items": [{ "sku": "BEANS-1KG", "name": "House beans 1kg", "unitPrice": 2400, "qty": 1 }] }
```

`validateOrder` names every problem with an order; the CLIs refuse an order that has any.

## Pricing rules

The settings live in `src/config.js`:

- A discount code takes a percent (`SAVE10`, `STAFF25`) or a fixed amount (`TAKE5`, $5.00) off
  the subtotal, never more than the subtotal. Codes match in any case; an unknown one is an error.
- Sales tax is 8% of the subtotal after the discount, rounded to the nearest cent.
- Shipping is $5.99 per order, and free from a $50.00 subtotal (before the discount).
- A pickup order (the customer collects it) pays no shipping.

## Receipts and invoices add up

The bookkeeper's import checks every receipt and invoice we send: the line amounts it prints must
add up to the subtotal it prints, and the subtotal, less any discount, plus shipping and tax, to
the total. A document that doesn't add up to the cent is rejected and has to be fixed by hand, so
every change to what they print keeps this true.

## Library

```js
import { computeTotals } from "order-pricing";
import { renderReceipt } from "order-pricing/receipt";
import { renderInvoice } from "order-pricing/invoice";
import { refundFor, renderRefundNote } from "order-pricing/refunds";
import { splitEvenly, splitByShares } from "order-pricing/split";
import { exportCsv } from "order-pricing/export";

computeTotals(order); // { subtotal, discount, code, shipping, tax, total }, in cents
computeTotals(order, { code: "SAVE10", pickup: true });
renderReceipt(order, { code: "SAVE10" }); // the receipt text, amounts in one column
renderInvoice(order, { number: "INV-0007", date: "2026-09-01", customer: "Northside Cafe" });
refundFor(order); // { items, shipping, tax, total }: the whole order, paid back
splitEvenly(4595, 2); // [2298, 2297]: the parts always add up to the total
```

`src/allocate.js` splits an amount in proportion to weights so that the parts add up exactly.

## CLIs

```
$ node bin/price-order.js examples/order.json
Subtotal: $37.00
Shipping: $5.99
Tax: $2.96
Total: $45.95
```

`--code <CODE>` applies a discount code, `--pickup` drops the shipping, and `--json` prints the
totals in cents instead.

`node bin/refund-order.js <order.json>` prints the refund note for a whole order (`--json` for the
amounts). `node bin/export-orders.js <folder>` prints the accounting export for every order file
in the folder: one CSV row per order, `id,date,subtotal,discount,shipping,tax,total`, amounts as
`$1234.50`.

## Plans

Work in progress is planned in `docs/plans/`, one file per feature, in slices.

## Tests

```
npm test
```
