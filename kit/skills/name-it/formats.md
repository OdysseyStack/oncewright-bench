# Glossary and ADR formats

Built from Matt Pocock's `domain-modeling` formats (mattpocock/skills v1.3.1, MIT).

## GLOSSARY.md

```md
# {Context name}

{One or two sentences: what this context is and why it exists.}

## Language

**Order**:
A customer's request to buy one or more items.
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request
```

- **Pick one word.** When several words name one concept, choose the best and list the others
  under `_Avoid_`.
- **Keep definitions to one or two sentences.** Say what the thing is, not what it does.
- **Only this project's concepts.** General programming ideas (timeouts, error types, retries)
  stay out, however often the code uses them.
- **Group terms under subheadings** when clusters appear; a flat list is fine otherwise.

### GLOSSARY-MAP.md (several contexts)

```md
# Glossary map

## Contexts

- [Ordering](./src/ordering/GLOSSARY.md): receives and tracks customer orders
- [Billing](./src/billing/GLOSSARY.md): generates invoices and takes payments

## Relationships

- **Ordering → Billing**: Ordering emits `OrderPlaced`; Billing consumes it to raise an invoice
```

## ADRs

One file per decision in `docs/adr/`, numbered in sequence: `0001-slug.md`, `0002-slug.md`.
Take the highest number there and add one.

```md
# {Short title of the decision}

{One to three sentences: the context, what was decided, and why.}
```

An ADR can be one paragraph: its value is recording that the decision was made and why. Add a
section only when it earns its place:

- `Status` (`proposed`, `accepted`, `deprecated`, `superseded by ADR-NNNN`), when decisions get
  revisited;
- **Considered options**, when the rejected alternatives are worth remembering;
- **Consequences**, when an effect downstream isn't obvious.

What qualifies, when the three tests hold (hard to reverse, surprising without context, a real
trade-off):

- the architecture's shape ("the write model is event-sourced; reads come from Postgres");
- how contexts talk to each other ("Ordering and Billing exchange events, never direct calls");
- technology with lock-in: the database, the message bus, the auth provider, the host;
- who owns what, including the explicit no's;
- a deliberate departure from the obvious path ("hand-written SQL, no ORM, because X"), which
  stops the next engineer from "fixing" it;
- a constraint the code can't show ("responses under 200 ms: the partner contract says so");
- a rejected alternative whose reason isn't obvious.
