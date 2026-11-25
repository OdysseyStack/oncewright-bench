// Splits an amount of cents into parts in proportion to weights, so that the parts always add up
// to the amount exactly: each part is rounded down, then the cents left over go one at a time to
// the parts that lost the most in rounding (the largest remainder method; ties go to the earlier part).
//   allocate(1000, [1, 1, 1]) -> [334, 333, 333]
export function allocate(cents, weights) {
  if (!Number.isInteger(cents)) throw new Error(`allocate: ${cents} is not a whole number of cents`);
  if (weights.length === 0) throw new Error("allocate: nothing to split between");
  if (weights.some((w) => !(w >= 0))) throw new Error("allocate: weights can't be negative");
  const total = weights.reduce((a, b) => a + b, 0);
  if (total === 0) {
    if (cents !== 0) throw new Error("allocate: every weight is zero");
    return weights.map(() => 0);
  }
  const sign = cents < 0 ? -1 : 1;
  const abs = Math.abs(cents);
  const exact = weights.map((w) => (abs * w) / total);
  const parts = exact.map(Math.floor);
  let left = abs - parts.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - parts[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left === 0) break;
    parts[i] += 1;
    left -= 1;
  }
  return parts.map((p) => sign * p);
}
