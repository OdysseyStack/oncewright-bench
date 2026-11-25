# Changelog

## Unreleased

## 0.7.0 (2026-10-04)

- Refunds of some of an order's lines, with a 15% restocking fee for opened items
  (`refund-order --sku`, `--opened`).
- With a discount code, the receipt and the invoice show each line after its share of the discount.
- `npm run check` runs the tests and the export import check before a commit.

## 0.6.0 (2026-09-22)

- Refund a whole order: `refundFor`, `renderRefundNote` and `refund-order`.

## 0.5.0 (2026-09-08)

- Split payments (`splitEvenly`, `splitByShares`) and the nightly accounting export
  (`export-orders`): one CSV row per order, `id,date,subtotal,discount,shipping,tax,total`.

## 0.4.0 (2026-08-25)

- Receipts with amounts in one column, and invoices for business customers.

## 0.3.0 (2026-08-11)

- The price-order CLI and order checks (`validateOrder`).

## 0.2.0 (2026-08-03)

- Line totals, discount codes, tax and shipping.
