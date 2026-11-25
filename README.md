# oncewright-bench

A cost benchmark for oncewright, a plugin for Claude Code (its plugin name is `odyssey`), published with
its harness and data so anyone can rerun it or re-score it.

The question: on the same small coding tasks, does a correct result cost more or less with the plugin
than with plain Claude Code? Each side ran three tasks 20 times each, 120 runs a phase, with Opus 5.5 at
high effort. There are two phases with the same tasks, sides, model and setting. `ship` is the clean one,
made with this harness as published. `cuts` is the earlier one, made under a condition a rerun does not
have.

## The result

### `ship`, runs 57 to 76: the one a rerun repeats

| side | runs | right on the first try | right at the end | changed a file out of scope | cost per correct result |
|---|---|---|---|---|---|
| with the plugin | 60 | 60/60 | 60/60 | 0/60 | $0.66 |
| plain Claude Code | 60 | 57/60 | 60/60 | 3/60 | $0.66 |

- **Cost per correct result, plugin over plain: 1.00x.** By task: G3 1.00x, G4 1.00x, G5 1.01x.
- **Spread:** in 10,000 resamples of the runs (with replacement, within each task, fixed seed) the ratio's
  95% range is 0.976 to 1.034; 5% of resamples come in under 0.98, and 38.3% under 1.00. The range spans
  1.00, so these runs show no cost difference either way.
- **Plain's three misses** were the same slip each time: in G3's second session it reworded a stale
  comment in `src/config.js`, a file that session was not asked to touch. One correction round put each
  run right.
- **Spend:** $79.13 in all by the ledger (plugin $39.65, plain $39.48), about 3.7 hours of `claude`
  calls, on Claude Code 2.1.330. A first smoke pair ($0.89) ran before the harness's last fix and is set
  aside (METHOD.md says why).

The full report is [data/report-ship.md](data/report-ship.md).

### `cuts`, runs 37 to 56: the earlier reading

| side | runs | right on the first try | right at the end | changed a file out of scope | cost per correct result |
|---|---|---|---|---|---|
| with the plugin | 60 | 60/60 | 60/60 | 0/60 | $0.65 |
| plain Claude Code | 60 | 57/60 | 60/60 | 3/60 | $0.67 |

- **Cost per correct result, plugin over plain: 0.97x** (95% range 0.946 to 0.988). By task: G3 0.95x,
  G4 1.00x, G5 0.97x. Plain's three misses were the same `src/config.js` slip.
- **Spend:** $79.68 by the ledger (plugin $39.10, plain $40.58), about 3.5 hours, on Claude Code 2.1.329.
- **How it differs from a rerun:** every session on both sides also loaded the runner's own
  `~/.claude/CLAUDE.md`. The clones sat under the runner's home folder, and Claude Code reads instruction
  files from every folder above its own. This harness puts the clones in the system's temp folder and
  refuses a run with such a file above it, so a rerun does not load one. The `cuts` runs also measured an
  earlier build of the plugin, and its setup was given no sensitive data to name, so its sessions had no
  sensitive-data rule. Both sides ran under the same conditions, so the ratio compares like with like,
  but only under those conditions.

The full report is [data/report.md](data/report.md).

### What moved between the two

Mean cost per run, `cuts` to `ship`: G4 fell $0.02 on both sides. G5 fell $0.02 on plain only. G3 rose
$0.05 on the plugin side and fell $0.01 on plain. In G3 the session-closing and session-opening turns
cost more on both sides, $0.05 a run with the plugin and $0.02 plain; the plugin's task turns held,
while plain's fell $0.02. The runner's file, the plugin's changes between the two builds and the Claude
Code version all changed at once, so these runs cannot say how much each one moved the cost.

These are measurements of these 240 runs on these three tasks, not a general effect, and of pre-release
builds of the plugin: `ship` measured `kit/` as of 2026-11-20, and the released 1.0.0 differs. The
limits are in [METHOD.md](METHOD.md), with how a run is judged right and how cost is counted.

## The tasks

All three run in one small Node repo made for the benchmark (`base-e/` and `base-g/`, 41 files, about
1,300 lines). Each has hidden tests the model never sees.

- **G3, a review round across two sessions.** Session 1 deals with three pasted code review findings
  (one to fix, one to decline because the README and the plan rule it out, one optional), then the
  session is closed. Session 2 opens fresh and implements the next slice of the plan on the same branch,
  without undoing session 1's fix.
- **G4, a check that cannot run.** Implement a slice and "make sure every check passes". The repo's
  `npm run check` skips one check because its tool is not installed. A right run says so instead of
  reporting everything green.
- **G5, a standing rule.** Three slices, one commit each. The third changes the export format, and the
  repo's `CLAUDE.md` says such a change must also update `docs/export-format.md` and `CHANGELOG.md`.

The plugin side closes and opens G3's sessions with the plugin's own `/odyssey:wrap-up` and
`/odyssey:handoff`. The plain side gets "Wrap up: save whatever the next session needs to carry on." and
"Carry on where we left off." Everything else is the same words for both sides.

## What is here

| path | what it is |
|---|---|
| `bench.sh` | the entry point: `init`, `vendor-kit`, `auth`, `run`, `ship`, `dry-run`, `unpack` |
| `bench-g.mjs` | the runner: clones, `claude -p` calls, saved state, the ledger, the correction loop |
| `score-g.mjs` | the scorer that writes the report |
| `fix.mjs`, `claims.mjs`, `scope.mjs`, `rework.mjs`, `usage.mjs`, `stage.mjs` | the correction message, the claim checker, the scope check and their helpers |
| `price-g.mjs` | prices a rerun from the published ledger |
| `proofs-g.sh` | free self-checks with a stand-in for `claude` (`fake/`) |
| `tasks/` | G3 to G5: prompts, hidden checks, allowed-file lists, reference fixes, decoys |
| `base-e/`, `base-g/`, `bundles/` | the task repo's sources, and the two starting repos built from them |
| `kit/` | the plugin the runs load, as the plugin's repo exports it (`bench.sh vendor-kit` swaps it) |
| `data/` | the ledger, the 240 runs and the two reports |

The data hold both phases, each with its own ledger rows: `cuts`, runs 37 to 56, and `ship`, runs 57 to
76. The harness makes only `ship` runs, in its own data folder (`work/`), with its own spending cap, and
measures `kit/` as it stands when the phase runs.

## Rerun it

You need Claude Code, Node, git and bash (the proofs ran on macOS with Node 26). A full rerun costs about
$80 at API prices and takes about 3.7 hours.

1. **Free self-checks.** `bash proofs-g.sh` runs every check that needs no model, with a stand-in for
   `claude`; a guard named `claude`, first on `PATH`, fails any call that would reach the real one. It
   takes a few minutes and ends with the count of checks passed.
2. **Log in.** The bench keeps its own Claude Code home, `work/home` (set `ODCK_BENCH` to use another data
   folder). From the repo's folder, log in there with `CLAUDE_CONFIG_DIR="$PWD/work/home" claude auth
   login`, or set `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`, which work on any system.
   `bash bench.sh auth` checks the login for free. Every `claude` call and every plugin setup step runs
   with `HOME` set to a throwaway folder (`work/user`), so what the runs write under `~` stays out of your
   own home. On macOS that folder links to your Keychain, where Claude Code keeps its login. The runs'
   clones go in the system's temp folder (`ODCK_RUNS` to choose another): Claude Code loads `CLAUDE.md`
   and `.claude/rules` from every folder above its own, so a run refuses while one sits above its clone.
   The binary is `claude` on `PATH`, or `CLAUDE_BIN`.
3. **See the commands.** `bash bench.sh dry-run ship` prints every command of all 120 runs and calls
   nothing. `node price-g.mjs` prices the phase from the published ledger.
4. **A smoke run.** One task, one run a side:

   ```
   ODCK_SHIP_CAP=10 bash bench.sh run g4-all-green plain-close 57
   ODCK_SHIP_CAP=10 bash bench.sh run g4-all-green kit-close 57
   ```

   By the published ledger's `cuts` rows the two runs cost about $0.84 together (the costliest pair
   was $0.89). G5 costs about $1.25 and G3 about $1.89 (set `ODCK_SHIP_CAP=15` for G3).
5. **The whole phase.** `ODCK_SHIP_CAP=110 bash bench.sh ship`. `ODCK_SHIP_CAP` is required and may be at
   most $110. A run starts only when its own cap fits under what is left, and runs already made are
   skipped, so a stopped phase picks up where it left off (the smoke runs count as two of its runs). A
   run cut off partway (Ctrl-C, a failed setup) is not skipped: the phase stops at it and names its
   folders and ledger rows, to move aside before running it again.
6. **Score it.** `node score-g.mjs > report.md` scores the `ship` runs in `work/`.

**Measure another build of the plugin.** Export the plugin's folder from its repo at the commit to
measure, then swap it in; `vendor-kit` replaces `kit/` and rebuilds the plugin side's starting repo
by running the new `kit/`'s own setup, and leaves the plain side's as it is:

```
mkdir <new folder>
git -C <the plugin's repo> archive <commit> plugin | tar -x -C <new folder>
bash bench.sh vendor-kit <new folder>/plugin
bash proofs-g.sh
```

Then commit `kit/` and `bundles/` together. Swapping in the same build again changes nothing.

On a Claude subscription the runs draw on its usage limits instead. The dollar figures are Claude Code's
own cost estimate at API prices, a yardstick that is the same for both sides, not a bill.

**Re-score the published data.** `bash bench.sh unpack <new folder>` copies `data/` into a folder and
unpacks the saved trees; `node score-g.mjs <that folder> ship` then prints `data/report-ship.md`, and
`node score-g.mjs <that folder> cuts` prints `data/report.md`, byte for byte (the last self-checks do
exactly this). It takes a few minutes and no model calls.

## License

MIT, see [LICENSE](LICENSE). By Lincoln Powers, Odyssey AI, Inc.
