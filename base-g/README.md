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

## Receipts and invoices

With a code, the receipt and the invoice show each line after its share of the discount (shares in
proportion to the lines' amounts), and the Subtotal after the discount:

```
1 x House beans 1kg @ $24.00    $21.60
2 x Paper filters x100 @ $6.50  $11.70

Subtotal                        $33.30
Shipping                         $5.99
Tax                              $2.66
Total                           $41.95

Code SAVE10 saved you $3.70
```

The invoice adds a Discount column. `computeTotals` returns the shares as `lines`, and
price-order's `--json` prints them.

## Receipts and invoices add up

The bookkeeper's import checks every receipt and invoice we send: the line amounts it prints must
add up to the subtotal it prints, and the subtotal, less any discount, plus shipping and tax, to
the total. A document that doesn't add up to the cent is rejected and has to be fixed by hand, so
every change to what they print keeps this true.

Refund notes go through the same import: the refunded lines it prints add up to `Items`, and
`Items`, less any `Restocking fee`, plus `Shipping` and `Tax`, to `Refund`. The fee stays a line
of its own, so the import can book it.

## Library

```js
import { computeTotals } from "order-pricing";
import { renderReceipt } from "order-pricing/receipt";
import { renderInvoice } from "order-pricing/invoice";
import { refundFor, renderRefundNote } from "order-pricing/refunds";
import { splitEvenly, splitByShares } from "order-pricing/split";
import { exportCsv } from "order-pricing/export";

computeTotals(order); // { subtotal, discount, code, shipping, tax, total, lines }, in cents
computeTotals(order, { code: "SAVE10", pickup: true });
renderReceipt(order, { code: "SAVE10" }); // the receipt text, amounts in one column
renderInvoice(order, { number: "INV-0007", date: "2026-09-01", customer: "Northside Cafe" });
refundFor(order); // { items, fee, shipping, tax, total }: the whole order, paid back
refundFor(order, { skus: ["MUG-12OZ"], opened: ["MUG-12OZ"] }); // one line, less a restocking fee
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
amounts). `--sku <SKU>` refunds only that line (repeat it for more): its amount and the tax on it,
and the shipping only when every line is refunded. `--opened <SKU>` marks a refunded line as
opened: the shop keeps a 15% restocking fee of its amount. A SKU that isn't on the order is an
error. Partial refunds of orders that used a discount code aren't supported yet. `node bin/export-orders.js <folder>` prints the accounting export for every order file
in the folder: one CSV row per order, `id,date,subtotal,discount,shipping,tax,total`, amounts as
`$1234.50` (`docs/export-format.md`).

## Plans

Work in progress is planned in `docs/plans/`, one file per feature, in slices.

## Checks

```
npm run check
```

runs the tests, then the export import check (`scripts/check-export.sh`), which feeds the example
orders' export to `ledger-check`, the bookkeeper's import checker. Run it before you commit.
`npm test` runs the tests alone. The export's columns are described in `docs/export-format.md`;
every change to them is listed in `CHANGELOG.md`.
