import assert from "node:assert/strict";
import test from "node:test";
import { renderInvoice } from "../src/invoice.js";

const order = {
  items: [
    { sku: "BEANS-1KG", name: "House beans 1kg", unitPrice: 2400, qty: 1 },
    { sku: "FILTER-100", name: "Paper filters x100", unitPrice: 650, qty: 2 },
  ],
};
const invoice = { number: "INV-0007", date: "2026-09-01", customer: "Northside Cafe" };

test("the invoice has a header, a table of the lines and the totals", () => {
  assert.equal(
    renderInvoice(order, invoice),
    [
      "INVOICE INV-0007",
      "Harbor Coffee Supply, 12 Pier Road, Portland, OR 97201. Tax ID 93-4417260",
      "Date: 2026-09-01",
      "Bill to: Northside Cafe",
      "",
      "SKU         Item                Qty    Unit  Amount",
      "BEANS-1KG   House beans 1kg       1  $24.00  $24.00",
      "FILTER-100  Paper filters x100    2   $6.50  $13.00",
      "",
      "Subtotal                                     $37.00",
      "Shipping                                      $5.99",
      "Tax                                           $2.96",
      "Total                                        $45.95",
    ].join("\n"),
  );
});

test("with a code, the invoice shows each line's discount", () => {
  const text = renderInvoice(order, invoice, { code: "TAKE5" });
  assert.match(text, /^SKU +Item +Qty +Unit +Discount +Amount$/m);
  assert.match(text, /^BEANS-1KG +House beans 1kg +1 +\$24\.00 +-\$3\.24 +\$20\.76$/m);
  assert.match(text, /^FILTER-100 +Paper filters x100 +2 +\$6\.50 +-\$1\.76 +\$11\.24$/m);
  assert.match(text, /^Subtotal +\$32\.00$/m);
  assert.match(text, /^Total +\$40\.55$/m);
});
