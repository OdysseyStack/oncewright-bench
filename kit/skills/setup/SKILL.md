---
name: setup
description: "Sets up the kit in this repo: an interview, a dry run, then the rules, config and empty slot, never overwriting; offers the status bar, the launcher, tips and mods. Rerun to upgrade. Also `/odyssey:setup status` and `/odyssey:setup doctor`."
argument-hint: "[status | doctor]"
disable-model-invocation: true
---

# Setup

Fit the kit to this repo. You run the interview and relay what the script prints; the script,
`scripts/odyssey.mjs`, does every file operation. Its writes are create-only, so setup never
overwrites a file the repo already has, apart from the upgrades §3 shows. Run every command from
the repo root.

**The argument picks the job:**

- none → set this repo up, or upgrade the kit's rules in a repo set up before: §1 to §7;
- `status` → run `node <this skill's base directory>/../../scripts/odyssey.mjs status` and show
  its report as it prints it;
- `doctor` → §1's Node check, then run `node <this skill's base directory>/../../scripts/odyssey.mjs doctor`.
  Show its report as it prints it, and say what fixes each FAIL line.

## 1. Preflight

- Run `node --version`. No `node`, or a version below 22 → stop, and give the install steps:
  install Node 22 or later from https://nodejs.org, or with a version manager (`nvm install 22`,
  `fnm install 22`); then restart Claude Code, so its hooks find the new `node`, and run
  `/odyssey:setup` again. Without Node the kit's hooks cannot start, so they guard nothing.
- Run `git rev-parse --show-toplevel`. Not a git repo → stop: setup runs at the root of a git
  repo. Run every command below from that root.

## 2. Interview

Skip it when `.claude/odyssey.json` exists already: the project files belong to the repo, and
this run only upgrades the kit's rules. Go to §3 without answers.

First read what the repo already says: `package.json` (its scripts, its dependencies and its
`type`), `tsconfig.json`, the top-level folders and `docs/`. Then show one numbered proposal
with every value filled in, from what you found or the default, and ask once: "Yes, or change N?"
Make each change the user names and show only the changed lines again, until they say yes.
The end-user identifiers, free text, payloads and hot path default to none, since few can judge
them on day one; propose where credentials live from what you found, such as a `.env` file.

1. **Project name** → `config.project`.
2. **Source and test folders** → `config.srcDirs` and `config.testDirs`; propose `src` and
   `test` when they exist.
3. **Sensitive data**, concretely: the categories and field names this project must never log,
   never a value → `sensitiveData.identifiers` (end-user identifiers), `sensitiveData.freeText`
   (free-text content) and `sensitiveData.payloads` (external request and response payloads);
   and **where credentials live**, as file names and variable names (`.env`, `~/.zshenv`, a
   keychain), never a value → `sensitiveData.credentials`. The rule setup writes from these
   also tells Claude how to read a credential without printing it; with nothing named in any
   of the four, setup writes no rule.
4. **The hot path**, as globs, and its invariants: the canonical pipeline, and any module-level
   state it allows → `hotPath.paths` and `hotPath.invariants`.
5. **Gate stages and fix commands** → `config.gate.stages`, each `{ "name", "command" }`, the
   stages CI runs; propose the `lint`, `typecheck`, `test` and `build` scripts `package.json`
   defines, run as `npm run <name>`. `config.gate.fix` holds the auto-fix commands, such as
   `npm run lint -- --fix`. The commit gate runs these stages before each commit Claude makes
   and blocks the commit when one fails; `config.hooks.commitGate: false` turns it off.
   Before proposing them, run each stage once from the repo root, as the commit gate would, with
   the Bash tool's timeout at 600000 ms, and show how long each took; check each fix command's
   program with `command -v` (running a fix changes files). Leave out one that fails on the
   untouched repo, since it would block every commit: name it with the last lines of its output,
   and say it goes back in `config.gate.stages` once it passes. The gate gives all its stages
   570 s together, so when the kept ones take more than about 500 s, leave out the slowest, one
   at a time, until the rest take under about 500 s, and say why for each.
   Then run `node <this skill's base directory>/../../scripts/odyssey.mjs docs check`: the
   gate runs it after the stages and blocks a commit on any error, such as a path an old README
   names. Show its errors and offer to fix them before the user approves the gate.
6. **The migration flow**, only when a migration tool is found, such as drizzle-kit or prisma →
   `config.db`: `schemaFile`, `seedFile`, `generate`, `migrate` and `seed`.
7. **Docs** → `config.docs.plan` (the plan, when it lives outside `docs/plans/`) and
   `config.docs.check` (the repo's own docs check, such as `npm run docs:check`, which the
   gate's docs stage runs after the kit's).
8. **Opt-in hooks** → `config.hooks`: `protectManifest` (with `config.protect.manifests` for
   manifests beyond npm's), `protectAppendOnly`, `formatOnEdit` (propose it when `package.json`
   lists `prettier`), `esmImportExtension` (propose it for a `"type": "module"` TypeScript project),
   `loadLog` (propose it: it logs which instruction files each session loads, for `/odyssey:audit`)
   and `typecheckGate` `{ "enabled", "command" }` (propose `npx tsc --noEmit` when there is a
   `tsconfig.json`). `formatOnEdit`, `typecheckGate` and the commit gate's stages run code, so
   they wait for the user's trust (§5).
9. **Protected files** → `config.protect.appendOnly` and `config.protect.readOnly` (file names,
   without folders).

In a repo without a `package.json`, read its own manifest and task runner instead, such as
`pyproject.toml`, `Cargo.toml`, `go.mod` or a `Makefile`, and propose from them. Gate stages and
fix commands are the commands the repo already runs, such as `make lint` or `pytest`, not
`npm run <name>`. Set `config.srcDirs` and `config.testDirs` when the repo's folders are not
`src` and `test`, the defaults; tests often live in `tests`. With `protectManifest`, name the
repo's own manifest and lockfile in `config.protect.manifests`, as file names without folders:
the guard matches on the file's name. Leave `formatOnEdit`, `esmImportExtension` and
`typecheckGate` off: the first runs only the Prettier and ESLint in `node_modules`, and the
other two ignore every file that is not TypeScript.

Leave out whatever the user leaves blank: every key has a default. Then write the answers with
the Write tool to `odyssey-setup-answers.json` in the session's scratchpad directory, or in the
system temp directory when there is none:

```json
{
  "config": { "project": "shop", "srcDirs": ["src"], "hooks": { "protectManifest": true } },
  "sensitiveData": { "identifiers": ["email"], "freeText": ["order.note"], "payloads": [], "credentials": [".env"] },
  "hotPath": { "paths": ["src/checkout/**/*.ts"], "invariants": ["No await before the charge call."] }
}
```

## 3. Dry run

Run `node <this skill's base directory>/../../scripts/odyssey.mjs plan --answers <file>`, without
`--answers` on a re-run that skipped §2, and show its output as it prints it. It lists each file
setup would create, replace, append to, keep or skip, and why, then the diff for each kit-owned
file edited since setup. When it names a problem in the answers, fix the file and run it again.

On a re-run it also lists what an earlier version left that this one retired. It removes the
`reviewers` and `layer2Owned` keys from `.claude/odyssey.json`, the one change setup makes to an
existing config. It removes a retired rule file that is untouched, and
`directives/layer_3_work_orders/` when it holds only its untouched placeholder, a `current.md`
with nothing but whitespace and HTML comments. An edited rule file,
or that folder holding anything else, is kept: it's the user's now, to delete when ready.

Nothing is written yet. Ask the user whether to apply. Ask separately about each kit-owned file
the dry run marks edited or deleted: replacing an edited one drops the user's changes, and
restoring a deleted one undoes their deletion.

## 4. Apply

Only on the user's yes, run the same command with `apply` in place of `plan`, adding
`--approve <path>` for each edited or deleted file the user chose to replace or restore. Show
its output as it prints it.

## 5. Trust

When apply's output ends with the trust lines, relay them as printed: each command the
switched-on hooks run, and the one approve command in full, with the script's absolute path. The
user runs it themselves, in a terminal in the repo or with `!` in this session. Only the user
decides what the hooks may run, so never run it yourself.

## 6. The status bar, the launcher, the tips, peek, wrap-up and ponytail

All six live outside the repo, in the user's settings, `~/.claude/settings.json`, or their
`~/.claude` and `~/.local/bin` folders, so they work in every project on this machine. Run
`bar status`, `tips status`, `mod status peek`, `mod status wrap-up` and `launcher status`, each
as `node <this skill's base directory>/../../scripts/odyssey.mjs <command>`; each prints one line
saying whether that one is on. Ponytail is on when its skills are already in this session, and
has nothing to refresh.

Refresh each one that is on without asking, by running its install command below, which
replaces a copy only when this kit version's differs and says what it did. Offer the ones that
are off in one call of the question tool, a line each, as multi-select questions of at most four
options each (the tool's limit), with the status bar, the launcher, the tips
and the wrap-up band marked recommended, and peek and ponytail not, since peek is experimental
and ponytail is another author's plugin:

- **The status bar** (`bar install`): how full Claude's context is, with a mark at 35% that says
  when to wrap up; the model and effort; the session's cost at API prices, marked plan or API;
  on Pro and Max plans, the 5-hour and weekly limits. Up to three rows, and each helper agent's
  row gets the same look. A status line already set stays in front of it (ponytail's plain
  [PONYTAIL] badge gives way to [ODYSSEY]).
- **The launcher** (`launcher install <name>`): a command run instead of `claude` that opens this
  repo from any folder and, once a session passes the wrap-up mark, saves memory, writes the
  handoff and starts the next session by itself. It reads the context from the status bar, and
  Claude still stops for anything the permission settings ask about. Name it with the initials
  of the repo folder's words, lowercase (`my-api` → `ma`); when the install refuses the name, ask
  for another.
- **The tips** (`tips install`): tips about the kit in the spinner, among Claude Code's own.
- **The wrap-up band** (`mod install wrap-up`): past the mark, a band above the prompt offers
  Wrap up, which saves memory and writes the handoff in one step.
- **Peek** (`mod install peek`): `/peek <path>` shows a file from this repo in a pane inside
  Claude Code (Markdown, code, tables, PDF and Word text, pictures and audio), and `/peek diff`
  what changed. It refuses the files the secrets guard protects, except that a `.env` file opens
  with its values masked.
- **Ponytail** (its two install commands): a separate plugin that pushes each change toward the
  smallest code that works, the same pressure the kit puts on scope, in every session.

Run the install command for each one picked, and show each output as it prints it. The two mods
need Claude Code 2.1.288 or newer, and load from the next session the user starts. For
ponytail, give its two install commands instead, to be sent as two separate prompts:

```
/plugin marketplace add DietrichGebert/ponytail
```
```
/plugin install ponytail@ponytail
```

The script makes every edit, and saves a copy of the settings file before its first one. Don't
offer the kit's Odyssey theme: it's in `/theme` for anyone who looks for it.

## 7. Report

Close with apply's summary line (written, kept, skipped) and the next steps below, then end with
the `Hooks on:` and trust lines that
`node <this skill's base directory>/../../scripts/odyssey.mjs status` prints, so the user sees
which hooks run and which wait for the approve command (a repo with no gate stages has no commit
gate):

- read the project rules setup wrote in `.claude/rules/`, and keep this project's own rules in
  `CLAUDE.md`;
- commit `.claude/odyssey.json`, `.claude/rules/` and `.gitignore`: the config is the project's
  settings, shared with everyone who works on it. Git operations wait for the user's approval;
- run `/odyssey:setup doctor` to check that each guard blocks a test call and each command a
  hook runs is trusted;
- with a launcher, quit and start the next session with its command.
