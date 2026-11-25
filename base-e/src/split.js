// Split payments: one order paid in parts (a gift card and a card, or several people).
// The parts always add up to the total, to the cent: allocate() makes sure of it.
import { allocate } from "./allocate.js";

// Splits total cents into n parts as even as cents allow; the first parts get the odd cents.
export function splitEvenly(total, n) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`splitEvenly: can't split into ${n} parts`);
  return allocate(total, Array(n).fill(1));
}

// Splits total cents by shares, e.g. { gift: 1, card: 3 } -> { gift: 25%, card: 75% } of it.
export function splitByShares(total, shares) {
  const names = Object.keys(shares);
  const parts = allocate(total, names.map((name) => shares[name]));
  return Object.fromEntries(names.map((name, i) => [name, parts[i]]));
}
