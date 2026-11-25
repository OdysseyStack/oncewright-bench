// Discount codes (the discount plan's Slice 1). The codes live in config.codes.
import { config } from "./config.js";
import { percentOf } from "./money.js";

// The code's settings, matched in any case. An unknown code is an error that names it.
export function findCode(code) {
  const key = String(code).trim().toUpperCase();
  const found = config.codes[key];
  if (!found) throw new Error(`Unknown discount code: ${code}`);
  return { code: key, ...found };
}

// What a code takes off a subtotal, in cents: never more than the subtotal.
export function discountFor(subtotal, code) {
  if (code === undefined) return 0;
  const c = findCode(code);
  const off = c.percent !== undefined ? percentOf(subtotal, c.percent) : c.amount;
  return Math.min(off, subtotal);
}
