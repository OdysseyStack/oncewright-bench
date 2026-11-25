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

test("with a code, the receipt shows the discount", () => {
  const lines = renderReceipt(order, { code: "SAVE10" }).split("\n");
  assert.equal(lines[4], "Discount (SAVE10)               -$3.70");
  assert.equal(lines.at(-1), "Total                           $41.95");
});
