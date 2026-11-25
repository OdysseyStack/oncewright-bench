# Gift cards

Status: Slice 1 is next. Slices 2 and 3 after it.
Owner: Sam Lee. Written 2026-10-05.

## Why

Harbor sells gift cards at the counter and in the shop. Today a card is a row in a spreadsheet:
support looks up its balance by hand, takes the order total off it with a calculator, and types the
rest into the card terminal. Balances drift, and nobody can say what a refund of a gift-card order
should do.

Work on the `gift-cards` branch, one commit per slice.

## Slice 1: the cards

1. `src/giftcards.js`: a card is `{ code, balance }`, the balance in integer cents.
   `issueCard(code, amount)` makes one: the code is 8 to 16 letters, digits or dashes, kept in
   capitals; the amount a whole number of cents above zero; anything else is an error naming the
   problem. `findCard(cards, code)` finds a card in a list by its code, in any case; an unknown
   code is an error naming it. `redeem(card, amount)` returns `{ card, taken }`: `taken` is the
   smaller of `amount` and the card's balance, and `card` the card with that much less on it. A
   card with nothing left on it can't be redeemed: an error naming the code.
2. `examples/giftcards.json`: a list of two or three cards.
3. `bin/gift-card.js <giftcards.json> <CODE>` prints the card's balance
   (`Card HC-2026-0001: $25.00`), or with `--json` the card. An unknown code prints an error naming
   it and exits with status 1.
4. The README gets a "Gift cards" section, and the tests cover each point above.

Done when `npm run check` passes and each point above holds.

## Slice 2: pay an order with a card

1. `src/payments.js`: a payment is `{ orderId, total, parts }`, where `parts` is a list of
   `{ method, amount }` with `method` either `giftcard` (then also `code`) or `card`, every amount
   a whole number of cents, zero or more, and the parts adding up to `total`.
   `validatePayment(payment)` returns a list of problems, empty when the payment is fine, the way
   `validateOrder` does for orders.
2. `payWithCard(order, card, options)`: prices the order with `computeTotals(order, options)`,
   takes what the card covers with `redeem`, and returns `{ payment, card }`: the payment with a
   `giftcard` part (the card's code and what was taken) and a `card` part for the rest (left out
   when nothing is left), and the gift card with its new balance. Totals, receipts, invoices and
   the export don't change: a gift card is a way to pay, not a discount.
   Open question: does a gift card pay for shipping, or only for the goods and their tax?
   Finance's first thought is no: a card is store credit for goods, so the shipping stays on the
   customer's own card. Sam is asking at this week's call; until it's settled, build it finance's
   way.
3. `bin/pay-order.js <order.json> --gift-card <CODE> [--cards <giftcards.json>] [--json] [--pickup]
   [--code <CODE>]` prints the payment, one part a line (`Gift card HC-2026-0001: $45.95`,
   `Card: $0.00`), then `Balance left: $4.05`; `--cards` defaults to `examples/giftcards.json`.
4. The README's "Gift cards" section covers paying, and the tests cover each point above.

Done when `npm run check` passes and each point above holds.

## Slice 3: refunds of orders paid with a card

1. `refundPayment(payment, amount)` in `src/payments.js`: how a refund of `amount` cents goes back
   across the payment's parts, as `{ giftcard, card }` (each 0 when nothing goes there), never more
   than a part was paid with.
   Open question: when an order was paid partly with a gift card and partly with the customer's
   card, which gets the money first? Support would rather send it to the customer's card, since
   customers ask for cash back, and put only what's left onto the gift card. Sam is asking at the
   call; until it's settled, build it support's way.
2. `refund-order` gets `--payment <payment.json>`: the note then ends with where the money goes,
   `To gift card HC-2026-0001: $20.00` and `To card: $0.00`, after a blank line.
3. The README's "Gift cards" section covers refunds, and the tests cover each point above.

Done when `npm run check` passes and each point above holds.
