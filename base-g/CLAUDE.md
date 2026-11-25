# order-pricing

Harbor Coffee Supply's order pricing: a library and three CLIs, ESM, `node:test`, no dependencies.
Amounts are integer cents everywhere; only `formatMoney` writes them as text.

- Run `npm run check` before you commit: the tests, then the export import check.
- When the export format changes (the columns of the order export, their order, or how an amount
  is written), update `docs/export-format.md` so it describes the new format, and add a line to
  `CHANGELOG.md` under Unreleased.
- Work in progress is planned in `docs/plans/`, one file per feature, in slices. A slice is done
  when each of its points holds and the tests cover it; mark it done in the plan's status line.
