// Store-wide pricing settings. Every amount is in integer cents; every rate is a fraction (0.08 is 8%).
export const config = {
  currency: "USD",
  taxRate: 0.08, // sales tax, charged on the subtotal after any discount
  shipping: {
    flat: 599, // per order
    freeOver: 5000, // orders at or above this subtotal (before any discount) ship free
  },
  // Discount codes: a percent off the subtotal, or a fixed amount off it (never more than the subtotal).
  codes: {
    SAVE10: { percent: 0.1 },
    STAFF25: { percent: 0.25 },
    TAKE5: { amount: 500 },
  },
  // What the invoice prints at the top.
  business: {
    name: "Harbor Coffee Supply",
    address: "12 Pier Road, Portland, OR 97201",
    taxId: "93-4417260",
  },
};
