import assert from "node:assert/strict";
import test from "node:test";
import { renderReceipt } from "../src/receipt.js";

const order = {
  items: [
    { sku: "BEANS-1KG", name: "House beans 1kg", unitPrice: 2400, qty: 1 },
    { sku: "FILTER-100", name: "Paper filters x100", unitPrice: 650, qty: 2 },
  ],
};

test("the receipt lists each line, then the totals, amounts in one column", () => {
  assert.equal(
    renderReceipt(order),
    [
      "1 x House beans 1kg @ $24.00    $24.00",
      "2 x Paper filters x100 @ $6.50  $13.00",
      "",
      "Subtotal                        $37.00",
      "Shipping                         $5.99",
      "Tax                              $2.96",
      "Total                           $45.95",
    ].join("\n"),
  );
});

test("with a code, each line shows its price after the discount", () => {
  assert.equal(
    renderReceipt(order, { code: "SAVE10" }),
    [
      "1 x House beans 1kg @ $24.00    $21.60",
      "2 x Paper filters x100 @ $6.50  $11.70",
      "",
      "Subtotal                        $33.30",
      "Shipping                         $5.99",
      "Tax                              $2.66",
      "Total                           $41.95",
      "",
      "Code SAVE10 saved you $3.70",
    ].join("\n"),
  );
});
