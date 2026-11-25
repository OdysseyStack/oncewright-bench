# Tests worth keeping

Built from Matt Pocock's `tdd` guides (mattpocock/skills v1.3.1, MIT).

## Good tests

Test behaviour through the public interface, not the implementation. A good test reads like a
line of the spec ("user can check out with a valid cart") and survives any refactor that keeps
the behaviour.

```typescript
// Good: observable behaviour, through the interface
test("user can check out with a valid cart", async () => {
  const cart = createCart();
  cart.add(product);
  const result = await checkout(cart, paymentMethod);
  expect(result.status).toBe("confirmed");
});
```

- It tests what callers care about, through the public interface only.
- Its name says what, not how.
- One logical assertion per test.

## Tests that prove nothing

**Coupled to the implementation.** It mocks the module's own collaborators, tests private
functions, counts calls, or checks a side channel instead of the interface. The tell: it breaks
when you refactor without changing behaviour.

```typescript
// Bad: checks the database behind the interface's back
test("createUser saves to database", async () => {
  await createUser({ name: "Alice" });
  expect(await db.query("SELECT * FROM users WHERE name = ?", ["Alice"])).toBeDefined();
});

// Good: checks through the interface
test("createUser makes the user retrievable", async () => {
  const user = await createUser({ name: "Alice" });
  expect((await getUser(user.id)).name).toBe("Alice");
});
```

**Tautological.** The expected value is computed the way the code computes it, so the test can
never disagree with the code. Expected values come from somewhere independent: a known literal,
a worked example, the spec.

```typescript
// Bad: recomputes the answer the way the code does
expect(calculateTotal(items)).toBe(items.reduce((sum, i) => sum + i.price, 0));

// Good: a literal worked out by hand
expect(calculateTotal([{ price: 10 }, { price: 5 }])).toBe(15);
```

## When to mock

Mock only at the system's edges: third-party APIs (payments, email), time and randomness, and
sometimes the database or the filesystem when no local stand-in exists. Never mock your own
modules or anything else you control.

At those edges, make mocking easy:

- **Pass the dependency in** rather than creating it inside: `processPayment(order, client)`, not
  a function that builds its own client from an environment variable.
- **One function per external operation** (`getUser`, `getOrders`, `createOrder`) rather than one
  generic `fetch(endpoint, options)`, so each mock returns one shape and needs no branching.
