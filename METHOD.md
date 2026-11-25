# Method

How the runs were made, how each was judged, how cost was counted, and what the numbers do not cover.
Every measured number here comes from the two reports, [data/report-ship.md](data/report-ship.md) for
the `ship` runs and [data/report.md](data/report.md) for the `cuts` runs, which `score-g.mjs` regenerates
from `data/`, except the $0.89 of the smoke pair set aside below, which is not in `data/`. Caps and
budgets come from the harness's code.

## The runs

- **Two sides.** `kit-close` loads the plugin from `kit/` with `--plugin-dir`; `plain-close` loads no
  plugin. The plugin side starts from `bundles/base-g-kit.bundle`: the same repo as the plain side's
  `bundles/base-g.bundle`, plus one commit made by the plugin's own setup script. Before each plugin run
  the harness also runs the plugin's `trust approve` in the run's folder, as a user who ran setup would,
  so the plugin's commit gate really runs. `bash bench.sh init` rebuilds both bundles from `base-e/`,
  `base-g/` and `kit/` and checks that they come out as the same commits.
- **The plugin side's setup answers.** Setup normally asks the user a set of questions; the harness gives
  the plugin's setup script these answers up front (in `bench.sh`), and the script writes the files:
  - project `order-pricing`; source folders `src` and `bin`; test folder `test`;
  - two gate stages, the checks the repo already runs: `npm test`, and `bash scripts/check-export.sh`;
  - one rule kept in step: when `src/export.js` or `bin/export-orders.js` changes the export format,
    `docs/export-format.md` and `CHANGELOG.md` change too (the rule the repo's `CLAUDE.md` states);
  - sensitive data, as a typical user would name it: one end-user identifier, `customer` (the field
    that holds an order's and an invoice's customer), and credentials kept in `.env`. No free-text or
    payload fields. From these the setup script writes `.claude/rules/sensitive-data.md`, which every
    plugin session loads. The plain side has no such file: it has no plugin.
  - nothing else: no hot path, no opt-in hooks, no protected files.

  The `cuts` runs' setup was given no sensitive-data answers, so it wrote no sensitive-data rule; the
  `ship` runs have it.
- **Each run** is a fresh clone. Every turn is one call:
  `claude -p <prompt> --model claude-opus-5-5 --effort high --permission-mode bypassPermissions
  --output-format json --strict-mcp-config --max-budget-usd <budget>`, resumed with `--resume` within a
  session. `bash bench.sh dry-run ship` prints every call.
- **Scripted turns.** Each session sends the task's prompt from `tasks/<task>/steps.json`. When the step is
  not done afterwards (its commit is missing), the session gets one fixed continuation, the same words for
  both sides: 16 plugin runs and 18 plain runs needed one in `ship` (16 and 25 in `cuts`). G3 also closes
  session 1 and opens session 2 with
  each side's own words (the README lists them). No run stopped at its cap, and no run hit the plugin's
  "approve and run" question, which the harness would have answered with "Approve and run".
- **After every turn** the harness saves the reply, the repo's state (HEAD, branches, `git status`, the
  diff) and, after each session, a copy of the whole tree. Those are what the scorer reads.
- **Auto memory** was on for both sides, as Claude Code ships it. In G3, what session 1 saved there
  loads into session 2 on either side; that is the only instruction file from outside a `ship` run's
  clone that any of its sessions loaded.
- **Recorded versions:** Claude Code 2.1.330 for `ship` and 2.1.329 for `cuts`; model `claude-opus-5-5`
  only.

## What counts as right

A run is right when all three hold for its last session:

1. **The hidden check passes.** `tasks/<task>/check.sh` copies the saved tree, adds that session's hidden
   tests (G3's second session runs session 1's tests too), and runs every test. Some hidden tests are
   traps, named `trap: ...`: each is built from a decoy fix that passes the repo's visible tests but is
   wrong, such as G4's report that says every check passed. `proofs-g.sh` shows each check fails on the
   untouched repo and on each decoy, and passes with the reference fix. Each check also asks that the
   work be committed on the task's branch: every file its tests read must match that branch's latest
   commit, with nothing uncommitted, so work left on another branch or only in the working tree fails.
2. **It stayed in scope.** Every file it changed is listed in `tasks/<task>/allowed-<session>.txt`
   (`scope.mjs`), or falls under one of two allowances `scope.mjs` adds on its own: `CHANGELOG.md`, on
   both sides, and the plugin's own `directives/` folder, on the plugin side. The first favours plain:
   plain changed `CHANGELOG.md` in every G3 run and in 14 of 20 G4 runs in `ship` (4 of 20 in `cuts`),
   and the plugin side never did in either task; G5 asks for a `CHANGELOG.md` line on both sides. No
   run's changes fell under `directives/`.
3. **Its last reply makes no false claim.** `claims.mjs` finds the checkable claims in a reply (file
   paths, commit ids, branch names, test names, "committed", "tests pass", "done") and checks each
   against the state saved after that turn. A claim it cannot settle, such as a file the run deleted,
   counts as "can't tell", not false. A negated statement ("nothing is committed yet", "not all tests
   pass") is read as what it says, not as the claim it denies.

"Right on the first try" means right after the scripted turns, before any correction round.

## Correction rounds

A run that is not right gets a follow-up from `fix.mjs`, written by the same code for both sides, so the
same problems get the same words byte for byte. It names the failing hidden tests by their assertion
messages (never their source or the trap label), any file changed out of scope ("You changed X; that
wasn't part of this, so put it back."), and any false claim ("You said Y, but Z."), then asks for the fix
on the task's branch. The run's last session is resumed with it and scored again, at most 3 rounds, each
with a $3 cap, the same for both sides. "Right at the end" means right after the last round. Every run
was right by then.

## Cost

- **Per turn.** Each `claude -p` call prints a JSON result whose `total_cost_usd` is Claude Code's own
  cost estimate for the session so far, at API prices. A resumed session reports its running total, so
  the ledger (`data/ledger.tsv`) records each turn's share: its total less the session's total before it,
  rounded to 4 decimals.
- **Per run.** Every ledger row of the run, its correction rounds included.
- **Cost per correct result.** A side's whole cost, every turn and round of every run, right or not,
  divided by its number of runs right at the end. The headline is the plugin's figure over plain's.
- **Budgets.** Each run has a cap (G3 $9 with the plugin and $5 plain, G4 $5 and $3, G5 $7 and $5; the
  plugin side gets more room for its setup). Each call's `--max-budget-usd` is the session's total so far
  plus the run's or round's cap left, clamped to what is left of the phase's cap (`ODCK_SHIP_CAP` for the
  `ship` runs; the `cuts` runs had `ODCK_CUTS_CAP`). Caps bound the spend; they do not enter the score.
- **Phases.** The ledger's first column names the phase: `cuts` for the earlier runs (n 37 to 56),
  `ship` for the clean ones (n 57 to 76). The harness makes only `ship` runs and counts only `ship` rows
  against its cap; `node score-g.mjs <folder> cuts` scores the earlier runs.
- **Resampling.** 10,000 draws of each side's runs with replacement, within each task, with a fixed seed;
  each draw gives a ratio, and the report gives their 95% range and the share under 0.98 and under 1.00.

## Limits

- **Three small tasks in one small repo** built for this benchmark. Real projects are larger and messier.
- **One model, one setting, one version a phase:** Opus 5.5 at high effort, Claude Code 2.1.330
  (`ship`) or 2.1.329 (`cuts`), with `bypassPermissions` and no MCP servers.
- **One login's skill list.** The bench's Claude Code home used a subscription login, and every session
  on both sides listed the skills that login brings. A home logged in to another account, or run on an
  API key, may list other skills, which shifts each session's start-up cost a little, on both sides
  alike.
- **20 runs a side per task.** The resampling range describes these runs; it says nothing about other
  tasks or repos.
- **Both sides were right at the end every time.** This measures what a correct result costs on tasks
  both sides finish, not how often either side fails outright.
- **Both phases measured pre-release builds of the plugin.** The `ship` runs measured the build in
  `kit/` as it stood on 2026-11-20 (`bench.sh vendor-kit` puts a build there), and the `cuts` runs an
  earlier one. Apart from privacy edits made after the runs, to code comments, test files, its README
  (the status bar's picture removed and one sentence reworded) and its license's copyright holder,
  `kit/` is that build unchanged, and none of these edits changes what the plugin does. Both manifests
  already read 1.0.0, but the released 1.0.0 differs from both, in its skills' text, its setup and its
  hooks. Later versions may cost more or less.
- **Costs are Claude Code's estimates at API prices.** On a subscription the runs draw on usage limits
  instead.

## What changed after the `cuts` runs

- **A scorer fix, which had favored the plugin.** As first scored, `claims.mjs` read a real commit id in
  a reply ("It sits on `<commit>`") as the name of a branch that did not exist, so it marked plain run
  `g3-review-round-plain-close-53` false three times: three correction rounds ($0.12), the run counted
  wrong on its first try and still wrong at the end, and the headline read 0.95x. The fixed checker no
  longer reads a commit id as a branch, and `proofs-g.sh` has a check for it. `score-g.mjs` now leaves
  out the saved rounds of any run whose first try the current checker passes, with their cost, and
  names the run under the report's cost table. That run is the only one.
- **Fixes from a code review of the harness, the same for both sides.** `claims.mjs` read "Nothing is
  committed yet" as a claim that the work was committed, so it marked one plain reply false: an open
  turn of `g3-review-round-plain-close-50`, not its last reply. It now reads that sentence as saying the
  work is not committed. Re-scored, plain's G3 "runs with a false claim" reads 0/20 instead of 1/20; no
  first-try or end result, cost or ratio moved. The other fixes change nothing in the report: each hidden
  check now holds the files its tests read to the task branch's latest commit, docs and examples
  included; G5's changelog check reads a wrapped entry whole and wants it to name the export's `pickup`
  column; `claims.mjs` counts every kind of uncommitted change (deleted and renamed files too), reads a
  path the run deleted as can't tell, skips a negated "tests pass", finds test names in folders under
  `test/`, and gives can't tell when a saved diff does not apply; and the harness saves `git status` and
  the diff untrimmed. `proofs-g.sh` has a check for each.
- **UTC for the runs' commits.** The `cuts` runs' commits carry the runner's local time offset. The
  harness now runs every `claude` call, plugin setup step and git command with `TZ=UTC`, on both sides,
  so a rerun's commits carry +0000.
- **A separate HOME for each call, and clones outside any home folder.** The `cuts` runs used the
  runner's own HOME, and its global git config, with only `CLAUDE_CONFIG_DIR` pointing at the bench's own
  Claude Code home, and their clones sat in the data folder, under the runner's home folder. Claude Code
  loads `CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md` and `.claude/rules` from every folder above
  its working folder, so every session on both sides also loaded the runner's own
  `~/.claude/CLAUDE.md`, as project instructions, and the plugin's `trust approve` wrote to the runner's
  `~/.claude`. Those instructions show in some replies: the model names the runner by first name,
  mentions a rule to start a CodeRabbit triage after a push, and says at wrap-up that no background
  agents or browser tabs are open. That file is kept in `reference/cuts-benchmark-CLAUDE.md`, as those
  runs loaded it, except that for publication three sections (rules for an agent that drives the
  owner's browser, for choosing a subagent's model, and for starting a CodeRabbit triage after a push)
  are each replaced by a one-line note, and a hook's file, a folder and a setting are no longer named.
  The harness now gives every `claude` call and every plugin
  setup step a throwaway HOME, puts the runs' clones in the system's temp folder (`ODCK_RUNS` to choose another),
  and refuses a run while any of those files sits in a folder above its clone. So a rerun loads none of
  that: its sessions start a little smaller on both sides, and its close turns may differ. The runs' own
  commits used the repo's identity, Sam Lee, which the harness sets in every clone.

- **A checker fix, the same for both sides, made before the `ship` runs.** To read "Not all tests pass"
  as no claim, `claims.mjs` skips a claim under a plan word ("once", "if", "will", "can", "after"). That
  also skipped "I can confirm all tests pass" and "After the fix, all tests pass", so a false claim worded
  that way went uncaught. Now "I can confirm" and "I can verify", and "after the fix," (or the change,
  edit, patch or commit) right before the claim, count as claims, for passing tests and for committed
  work. "I cannot confirm" now reads as a negation, as "I can't confirm" already did. "Not all tests
  pass", "I'll run the tests after the fix", "once the tests pass" and "after the fix lands, ..." still
  make no claim. Re-scored, the published data gives the same report, byte for byte. `proofs-g.sh` has a
  check for each form.
- **The plugin side's setup names sensitive data** (above), so a `ship` run's plugin sessions load the
  sensitive-data rule its setup writes; the `cuts` runs' did not. `proofs-g.sh` checks that the rule in
  the bundle is what `kit/`'s own setup script writes, and that a swapped-in build's text reaches it.
- **No instructions from outside the repo.** `proofs-g.sh` plants a `CLAUDE.md` in a stand-in for the
  runner's own `~/.claude/`, checks that no run's call, on either side, can see it, nor any `CLAUDE.md`
  in the throwaway HOME, the bench's Claude Code home or a folder above its clone, and that a run refuses
  while any of the four kinds of file sits in a folder above its clone. The stand-in looks where Claude
  Code looks: the user-level files and every folder above its working folder. A first smoke pair (G4,
  n 57, both right on the first try) ran before this check and still loaded the runner's file, from the
  clones' place under the runner's home; it was set aside ($0.89) and is not in the data.
- **A display fix in the scorer, after both phases.** A wall time that rounded up to a whole minute
  printed as "0m 60s"; it now prints "1m 00s". One cell in each report changed; no score moved.

## Reading the `ship` runs

- **One false claim, a checker error read by hand.** `claims.mjs` marked one reply false: the open turn
  of plain run `g3-review-round-plain-close-71`'s second session. It begins "Last time, `refunds-fixes`
  (the CodeRabbit fixes) was committed", which is true of session 1's branch. The checker read it as a
  claim that this turn's work was committed, which it was not, as the reply itself says two lines later.
  That turn is not the run's last reply, so no result, round, cost or ratio moved; it shows only as
  plain's G3 "runs with a false claim" 1/20. The checker was not changed after the data were seen.
- **One refused tool call.** In the open turn of plain run `g3-review-round-plain-close-72`'s second
  session, Claude Code refused one Bash call, which wrote a test-patch script to `/tmp`, outside the
  clone. The turn's JSON records the refusal (kept in the published data) but not its reason. The run
  went on and was right on the first try. No plugin turn had a refusal.

## The published data

Each run is `data/runs/<task>-<arm>-<n>.out/`: `sessions.json` (the turns), the turn JSONs, the replies
(`messages/`), the state after each turn (`state/`), the tree after each session (`tree-s<n>.tgz`), and the
correction rounds (`fix/`). To publish them without anything that identifies the machine, network or
account that ran them:

- **No session transcripts.** Context peak, first request and wall time, and the Claude Code versions and
  models, were computed from the transcripts; each run's `usage.json` holds those figures, and the
  scorer reads them from there.
- **The turn JSONs keep only** the reply, the outcome (how the turn ended, its number of model turns
  and its durations), the cost, the token counts and any refused tool call (one in all, above).
- **Session ids** are `session-1` and `session-2`, and the one refused call's tool-use id is
  `tool-use-1`.
- **Paths:** the data folder of the runs reads `/bench`, the plugin `/bench/kit`, the `ship`
  runs' clones `/bench/runs`, the runner's home `~`.
- **The saved trees** have no reflogs, and their git index carries no file times, device or user numbers.
  Their commits are untouched, since the replies name them by id; the `cuts` runs' commits carry the
  runner's local time, the `ship` runs' UTC. So the `cuts` commits show the runner's time zone (-0600)
  and the hour each was made, and the `ship` commits their hour in UTC.

The ledger and the tree contents are as recorded.
