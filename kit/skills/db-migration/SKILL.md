---
name: db-migration
description: Generates, reviews and applies a schema migration with the repo's tool, to a local database only, keeping the seed idempotent. Use after a schema change or to create or run a migration.
disable-model-invocation: true
---

# DB Migration

Drive a schema change through the repo's migration flow safely. Source of truth: the
database section of the project's instruction file.

**The flow comes from the config.** Run `node <this skill's base directory>/../../scripts/odyssey.mjs config`
from the repo root. It prints `{ root, file, config, notice }`, and the flow is `config.db`: the
files `schemaFile` and `seedFile`, and the commands `generate`, `migrate` and `seed`. A `notice`
means the config file is invalid: show it. No `db` block → say "This repo has no migration flow
configured — run `/odyssey:setup` to add one," then stop. `seed` and `seedFile` are optional, and
a repo without a seed skips those steps; any other missing key → say which, and stop.

## Guardrails (read first)

- **When production runs migrations is the project's rule, not this skill's.** The project's
  instruction file says when; from here, add no migrate or seed call to the app's own startup
  code.
- **Apply to a LOCAL/dev database only.** Production migrations run however the project's
  deploy runs them, and the user owns prod config and prod runs. Do not point
  `db.migrate` at a production `DATABASE_URL` from here.
- **Schema changes are a `schema_change` meta type.** Where the schema holds the sensitive data
  `.claude/rules/sensitive-data.md` names, keep real values of it out of the seed.
- **The seed must stay idempotent** — re-running it must not duplicate or clobber existing rows.

## Flow

1. **Confirm the schema edit.** Read `db.schemaFile` and confirm the intended change is
   present. If it is not and the user described it, make it directly: invoking this skill and
   describing a schema change is a request for that one edit, and the hooks still apply. Apply the patterns the project's instruction file asks for (for example, an index on a key
   the app sorts by, and a check on a value that can't be negative).

2. **Generate the migration:** run `db.generate`, which diffs the schema into a new migration.

3. **Review the generated migration — the critical step.** Open the new migration file and read it
   line by line. Confirm:
   - No unintended `DROP` or destructive column changes.
   - New columns on existing tables are nullable or have a safe default (existing rows must
     migrate cleanly).
   - Indexes and constraints match the schema intent.

   Report a summary of the migration to the user before applying.

4. **Apply locally** (requires a local/dev `DATABASE_URL`): run `db.migrate` to apply the pending
   migrations, then `db.seed`, the idempotent seed, if the config sets one.
   If `DATABASE_URL` is unset or points at prod, stop and ask — do not apply.

5. **Docs and seed:** update the docs that describe the schema. If the config sets
   `db.seedFile`, confirm the seed is still idempotent.

6. **Verify:** run the gate as `../local-gate/gate.md` says. Then stop — committing the schema and migration is a
   separate, explicitly approved step (git is approval-gated).
