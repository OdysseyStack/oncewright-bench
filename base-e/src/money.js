// Money helpers. Amounts are integer cents everywhere; only formatMoney turns them into text.
// TODO: other currencies when the EU shop opens (the receipt plan's Slice 3)

// 4595 -> "$45.95", -370 -> "-$3.70".
export function formatMoney(cents) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, "0");
  return `${sign}$${dollars}.${rest}`;
}

// rate is a fraction: 0.08 for 8%. Rounds to the nearest cent.
export function percentOf(cents, rate) {
  return Math.floor(cents * rate);
}

export function sumCents(amounts) {
  return amounts.reduce((total, amount) => total + amount, 0);
}

