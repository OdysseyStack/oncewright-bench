---
name: index-it
description: Audits and restructures this project's Claude Code memory store. Use for "index it", "fix the memory index", "MEMORY.md is too big", or when the index passes its size target.
disable-model-invocation: true
---

# Index It

Restructure the memory store for the project this session is in: `MEMORY.md`
becomes a **router** whose hooks are good enough to decide relevance without
opening anything, topic hubs hold the clusters, and supersession is recorded
where a machine can read it.

It never deletes. It proposes.

## The three laws

These come from what goes wrong in practice; violating them is how a memory
store rots while looking maintained.

**1. Regenerate, never paraphrase.** Every hook is written from the memory
file's own body. Never from the previous hook, never from another hook, never
from the index you are replacing. Iteratively rewriting a summary from the last
summary is a photocopy of a photocopy — meaning drifts, details invent
themselves, and the corruption compounds silently because each pass looks
locally reasonable. If you have not read the file's body this run, you may not
write its hook: carry the old line through untouched and say so in the report.

**2. Append and mark; do not rewrite bodies.** Memory bodies are append-only.
When a fact is superseded, you add the new block and stamp the old one — you do
not edit the old claim into the new one. But a pure append-only store has its
own failure: the old and new versions coexist and the reader has to guess which
is current. So every supersession is recorded in frontmatter (below), not left
as prose the reader has to notice.

**3. Route by type before topic.** Episodic memories (dated lane state, session
handoffs, "where the PR stands") rank by **recency** — newest first, and the
stale ones belong in an archive hub. Procedural and semantic memories (rules,
corrections, vendor facts) rank by **topic** and have no useful recency order.
Mixing them into one ranked list degrades both. Keep them in separate index
sections and never sort them together.

## Run modes

- `/odyssey:index-it` — **propose only.** Survey, read, and produce the plan. Writes
  nothing except the survey output. This is always the first run on a store.
- `/odyssey:index-it apply` — apply the restructure: hubs, hooks, supersession stamps,
  index rewrite. Still never deletes; retirements stay proposals.
- `/odyssey:index-it retire` — after the user has approved specific retirements by name,
  move only those files to `archive/`, drop their index lines, and drop or repoint each hub
  link to them, so the survey's `dangling_links` stays empty.

Arguments naming a path (`/odyssey:index-it ~/some/repo`) survey that project's store
instead of the current one.

## 1. Survey

```bash
python3 <this skill's base directory>/scripts/survey.py --sessions 20
```

Run it from the project directory (survey.py finds the memory store from the current directory).
When the argument names a path, add `--cwd <that path>`.

Read-only, prints JSON. It resolves the store from the real cwd
(`~/.claude/projects/<the real path, each character that isn't a letter or a digit as a dash>/memory/`),
measures the index
and every hub, checks reachability both ways, flags single-memory index lines
over 200 bytes, and mines the last N transcripts for usage.

If `exists` is false, the session was started from a different directory than
the one that owns the memories — `similar_stores` names the likely one. Stop
and tell the user; do not create a second store.

**Thresholds** (the script reports against these): index target **16 KB or
150 lines**, hard ceiling **24.4 KB or 200 lines** — Claude Code loads only the
first 200 lines or 25 KB of `MEMORY.md`, so past the ceiling the tail of the
file is silently cut out of context and those memories become unreachable. Hub
target **8 KB**. A single-memory index line should be **≤200 bytes**.

Below 8 KB and 150 lines, with no hub over target, nothing unreachable and no
index line over 200 bytes (the survey's `index.long_lines` is empty), say so and
stop, unless the user asked for the hooks to be rewritten.
Restructuring a healthy store is churn, and by law 1 every rewrite costs
fidelity.

## 2. Read the usage evidence

The survey gives two counts per memory, and they mean different things:

- **`opened`** — the file path appeared in a transcript, i.e. it was actually
  read. Real signal.
- **`mentioned`** — the bare filename appeared, which also matches every time
  the index itself is echoed. Near-useless alone; ignore it.

`never_opened` is usually most of the store, and **that is not a retirement
trigger.** A memory whose hook is good does its job without ever being opened.
Use the counts for the opposite purpose:

- Frequently opened → its hook is not carrying enough; the hook is the bug.
  Rewrite it so the next session does not need to open the file.
- Never opened **and** its topic came up in those sessions → the hook failed to
  route. Rewrite it.
- Never opened **and** the topic never came up → candidate for a hub or the
  retirement proposal, decided on content, not on the count.

## 3. Propose (always, before any writing)

Read every file you intend to touch. Produce four lists:

1. **Supersession** — pairs where a newer memory replaces an older one. Propose
   a `superseded_by` stamp, never a merge of the two texts.
2. **Duplication** — two files covering one fact. Propose which is canonical.
   Do not merge bodies; make one a stamped pointer to the other.
3. **Retirement** — closed lanes, spent pointers, provenance nothing will route
   on. These leave the index, not the disk.
4. **Typing and dating** — files missing `metadata.type`, or carrying dated
   state with no `asof`.

On the first run this is the whole output. Present it and stop.

## 4. Restructure (apply mode)

Back the index up first:

```bash
cp "<store>/MEMORY.md" "<backup dir>/MEMORY.md.bak"   # <store> = the survey's `store` field
```

**Index layout**, in this order, by law 3:

```markdown
# Memory Index

## Now — live state (newest first)
## Traps that fire often
## Rules and corrections
## Domain topics
## Reference and archive → hubs
```

**Hub rules.** A hub is an ordinary memory file (`type: reference`) whose body
is one line per member, plus frontmatter whose `description` names every topic
inside — recall matches on that description, so a badly described hub buries its
whole cluster. Name hubs for their **topic**, never by number:
`hub-payments-lane`, not `extended-memory-002`. A number carries no routing
information, which forces a read to discover relevance — the exact cost the
router exists to avoid. Split a hub only when it passes 8 KB, and split it by
sub-topic with a new topical name.

**Hook specification.** A hook must answer three things without the file being
opened:

1. **What it is about** — the topic, in the words a future session would use.
2. **What the answer is** — the verdict, state or number. Not that an answer
   exists.
3. **When it fires** — the trigger, if it is not obvious from the topic.

Rules: ≤200 bytes. Present tense. Lead with the conclusion, not the history.
Backtick every identifier, path and symbol. Never write "see inside", "details
within" or "notes on X" without saying what the detail *is*. Keep the ★ severity
convention if the store already uses one.

```
Bad   - [webhook-retry-semantics](webhook-retry-semantics.md) — notes on webhook retries.
Good  - [webhook-retry-semantics](webhook-retry-semantics.md) — ★★★ provider retries 3× over 24 h; dedupe on `event_id`, never on payload hash.

Bad   - [ci-runner-auth](ci-runner-auth.md) — runner setup details.
Good  - [ci-runner-auth](ci-runner-auth.md) — runner has no `.env`; secrets come from the CI vault; re-auth recipe inside, incl. token refresh when a job is re-queued.
```

**Moving a long line out of the index.** If an index line carries content that
may exist nowhere else, append it verbatim to its target file under
`## Index overflow, moved here <date>` *before* shortening the line. Never
delete text you have not confirmed lives somewhere else — a cheap grep for a
paraphrase does not confirm it.

## 5. Frontmatter conventions

Extend the existing schema; do not replace it. Extra `metadata` keys are safe.

```yaml
---
name: <slug matching the filename>
description: <one line; this is what recall matches on>
metadata:
  type: user | feedback | project | reference
  asof: 2026-09-18            # when this was last known true — dated state only
  superseded_by: <slug>       # set when another memory replaces this one
---
```

A stamped file keeps its body intact and gains a dated block at the end saying
what replaced it and why. `type` is load-bearing, not decoration: it decides
which index section the memory routes into (law 3).

## 6. Verify

Re-run the survey. The run has failed unless:

- `unreachable` is empty — every memory reachable from the index or a hub.
- `dangling_links` is empty — no pointer to a file that does not exist.
- `index.over_target` is false (the bytes and the lines both under target),
  and no hub is over target.
- The file count is unchanged, or changed only by hubs you created and by the retirements the
  user approved (the survey doesn't count `archive/`).

## 7. Report

- Index bytes and lines before → after, and hub count.
- Hooks rewritten from source vs. carried through untouched (law 1).
- The four proposal lists, as decisions the user owes.
- Any threshold still breached, and what would fix it.
- Where the backup is.

Never report a store as clean on a survey you did not re-run.
