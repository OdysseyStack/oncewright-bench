# oncewright

A Claude Code plugin that keeps planned work inside the files its plan names, has Claude decide
open choices instead of asking, and runs the repo's gate before every commit Claude makes. Its
always-on rule is under 1 KB; what a script can enforce runs as a hook instead, which adds
nothing to Claude's context until it fires.

Around that it adds a CodeRabbit review loop with recorded verdicts, a handoff between
sessions, memory upkeep, and guard hooks, such as the one that blocks Claude's writes to secret
files.

**Built by Lincoln Powers ∙ Odyssey AI, Inc.** — [odysseystack.com](https://www.odysseystack.com)

An independent project for Claude Code, not affiliated with or endorsed by Anthropic.

## Quickstart

About ten minutes, in a repo you can experiment in. Send each block as a message of its own.

1. **Install.** Add the marketplace:

   ```
   /plugin marketplace add OdysseyStack/oncewright
   ```

   Then open the plugin's page:

   ```
   /plugin install odyssey@odyssey-ai
   ```

   Install it there and close the panel: Claude Code loads the plugin into the session.

2. **See a guard work.** Ask Claude to write `FOO=1` to `.env`. The secrets guard is on from
   the start, and it stops the write:

   ```
   Blocked: writing "…/.env" is not allowed. It matches a secret-file pattern: …
   ```

3. **Fit it to the repo.** At the repo's root:

   ```
   /odyssey:setup
   ```

   It shows one filled-in proposal for you to confirm or change, then a dry run, and writes only
   on your yes. Near the end it offers [a status bar](#the-status-bar-and-the-theme),
   [a launcher](#the-launcher), a few spinner tips, the wrap-up band,
   [peek](#peek-experimental), an experimental file viewer, and
   [ponytail](#why-we-recommend-ponytail), a separate plugin, for your machine, in one step
   where you pick which. Then check the result, and run the approve command it prints, which
   turns on the commit gate and the other hooks that run your commands:

   ```
   /odyssey:setup doctor
   ```

   **From here on, sessions in this repo work differently.** Work that comes from a plan stays
   inside the files the plan's slice names, with their tests and any file your CLAUDE.md
   requires for that change; another file is changed only on
   your yes, and otherwise reported. Open choices are decided, not asked about, unless a wrong
   guess would be costly to undo. Before each commit Claude makes, the commit gate runs the
   repo's gate stages, every one to the end, and blocks the commit if one fails.

4. **Commit what setup wrote:** `.claude/odyssey.json`, `.claude/rules/` and `.gitignore`. Do it
   before the first change, or setup's files show up in that change's diff.

5. **Take one small change through the cycle.** Have Claude write a short plan for it in
   `docs/plans/`, then ask it to make the plan's first slice and commit it. Claude names the
   files the slice touches before its first edit, stays inside them, and marks the slice done in
   the plan; the commit runs the gate first.

6. **Let sessions follow one another.** If you added a launcher, quit and start Claude with its
   command from now on. Once a session passes the wrap-up mark, it saves memory, writes the
   handoff and starts the next session, which reads the handoff and carries on.

The rest of the cycle, the review loop, handoffs and memory, is in
[How the cycle works](#how-the-cycle-works).

## Why this exists

I build production AI agents for real businesses, and the model was never the hard part — the
drift was. Every guardrail in this kit answers one of these failures:

- **Sessions forget what was decided.** Plans, review verdicts, memory and the handoff all live
  in files, so no decision depends on a chat being remembered.
- **Long sessions lose the thread and start making things up.** Every stage starts in a fresh
  session that works from those files, and when a long one is compacted anyway, a hook tells
  Claude so — see Checkpoints below.
- **Keeping a session's context in check becomes your job.** The [launcher](#the-launcher) ends
  a session at the wrap-up mark, once memory and the handoff are saved, and starts the next one
  on that handoff, so long work carries on by itself.
- **Claude "helpfully" edits files nobody asked it to touch.** Before a planned change's first
  edit, Claude lists the files the plan's slice names, plus any your CLAUDE.md requires for
  that change, and stays inside them; any other file
  waits for your yes, and `git diff --name-only` is checked against the list at the end.
- **Two sessions overwrite each other's notes.** One file holds the next session's opening
  message, and writing over one that's still waiting asks first: a convention the skills keep,
  not a lock.
- **A review finding gets argued again every round.** Every finding becomes a recorded verdict,
  and its thread on the pull request gets a one-line reply that CodeRabbit learns from.
- **A rejected finding quietly shapes every future review.** CodeRabbit can save a reply as a
  learning, and triage names each one it saved under a rejection or a deferral, with where to
  edit or delete it.
- **A PR gets merged over a warning nobody read.** Triage lists open items first and puts the
  verdict last.
- **"All green" gets claimed on checks that never ran.** The gate reports how many checks it
  ran, and says INDETERMINATE when one didn't.
- **A commit lands on a red gate.** The commit gate, a hook, runs the repo's gate stages before
  each commit Claude makes and blocks the commit while one fails, with no rule text for Claude
  to remember.
- **A brand-new file slips past review.** `git diff` never shows it, so `/odyssey:review-me`
  reads untracked files in full beside the diff.
- **Docs drift until they describe a system that no longer exists.** The gate's docs stage, a
  script that costs no model tokens, checks that every path, file, script and ADR they name
  exists.
- **A rule sits in a file Claude never loads, or two instruction files disagree.**
  `/odyssey:audit` lists which files Claude Code loads and when, and reads them for rules that
  never reach Claude, claims the code disproves, and rules that contradict each other.
- **Hand edits break lockfiles or overwrite logs meant to be append-only.** Two opt-in hooks
  block both; you name the files in `.claude/odyssey.json`.
- **Claude overwrites a `.env` or a key file while fixing something else.** The secrets
  guard blocks Claude's writes to `.env` and the other secret files through edits, shell
  commands, PowerShell and four MCP file tools, symlinks included. It does not check what gets
  committed.

It's the setup I run every day, packaged so you can run it too.

## Requirements

- **[Claude Code](https://claude.com/claude-code) 2.1.139 or later.** That release added
  exec-form hooks (the `args` field), which the kit's hooks use on every platform. A plugin
  can't declare a minimum version, so it is stated here. The kit was tested on 2.1.289. The
  status bar's helper-agent rows show an agent's model from 2.1.205 and its effort from
  2.1.214, its spend-limit bar needs 2.1.251, the spinner tips need 2.1.247, and peek needs
  2.1.288.
- **Node.js 22 or later.** The hooks and the setup script are Node ESM scripts, and their tests
  use the built-in `node --test` runner. Node 20 reached end of life in April 2026.
  `/odyssey:setup` checks for Node first.
- **git** and the **[GitHub CLI](https://cli.github.com/)** (`gh`), signed in —
  `/odyssey:cr-triage` reads PRs and reviews through it.
- **[CodeRabbit](https://www.coderabbit.ai/)** — the GitHub app on your repo for PR reviews,
  and its CLI (`coderabbit`) for reviewing a branch before a PR exists. Without the CLI the
  pre-push review is skipped, and Claude says so.
- **Python 3** — for the memory survey script that `/odyssey:index-it` and
  `/odyssey:remember-session` run.
- **Prettier and ESLint** as devDependencies, only if you switch `formatOnEdit` on. The
  formatter runs the nearest install from the edited file's folder up to the git root, so a
  workspace that installs them once at its root is covered. It does nothing without them, and
  `doctor` fails when it finds no Prettier.

## Install

```
/plugin marketplace add OdysseyStack/oncewright
/plugin install odyssey@odyssey-ai
```

The first command registers the marketplace, named `odyssey-ai`, on your machine. The second
installs the plugin at user scope, so it is on in every project there. For a team, install it
once at project scope instead: `claude plugin install odyssey@odyssey-ai --scope project` records
it in `.claude/settings.json`, which you commit. Each teammate registers the marketplace on their
own machine with the first command, and Claude Code tells them to install the plugin when it
finds it enabled but missing. `claude plugin details odyssey` shows what the plugin adds to a
session.

Each skill's command starts with the plugin's name, as in `/odyssey:handoff`, and you don't have
to type all of it: in the terminal, `/hand` lists `/odyssey:handoff` in the `/` menu, and
`/remem` lists `/odyssey:remember-session`.

Then, in each repo, run `/odyssey:setup` (below). Without it the two always-on guards still
work, the other hooks stay off, and a skill that reads the config falls back to its defaults.
The cycle needs it: setup installs the rule the cycle follows and the handoff file sessions pass
work through.

### Updating and pinning

- **Updates are yours to take.** A marketplace you added yourself doesn't auto-update unless you
  turn that on (`/plugin`, Marketplaces tab). To update by hand: refresh the listing with
  `/plugin marketplace update odyssey-ai`, then update the plugin with
  `claude plugin update odyssey@odyssey-ai` in a shell, or **Update now** on the Installed tab of
  `/plugin`. The new version loads in your next session. Then run `/odyssey:setup` again in each
  repo to upgrade the kit-owned rule it wrote there.
- **Pin a version** by adding the marketplace at a release tag:
  `/plugin marketplace add OdysseyStack/oncewright#v1.0.0`. Release tags never move.
  To roll back, pin the previous tag.
- **Every release** bumps `version` in the plugin manifest, which is how Claude Code sees an
  update, and [CHANGELOG.md](CHANGELOG.md) names every hook that changed.

### Turning it off

In a session, `/plugin` (Installed tab) disables the plugin. From a shell,
`claude plugin disable odyssey@odyssey-ai --scope project` turns it off for everyone in the
current repo, and `--scope local` for you alone. Everything the plugin adds goes with it, the
secrets guard included: that is deliberately the only way to switch the guard off in a repo
where editing `.env` is the job.
The status bar, the helper-agent rows, the spinner tips and peek stay, since they live in your
user settings; [Removing the bar, the rows and the tips](#removing-the-bar-the-rows-and-the-tips)
and [Removing peek](#removing-peek) say how to take them out.

### Removing it

`claude plugin uninstall odyssey@odyssey-ai` removes the plugin (add `--scope project` if you
installed it there), and `claude plugin marketplace remove odyssey-ai` removes the marketplace.
What `/odyssey:setup` wrote stays in each repo, and the kit's rules there keep loading in every
session, naming skills that are gone. Delete what you don't keep as your own:

- `.claude/rules/odyssey/`, and `sensitive-data.md` and `hot-path.md` beside it, when setup
  wrote them;
- `.claude/odyssey.json`;
- `directives/handoff/` and `references/CR reviews/`;
- the kit's two lines in `.gitignore`.

On your machine, `~/.claude/odyssey-trust.json` holds the commands you approved, and
`~/.claude/odyssey-loads/` the load log, if you turned it on. A launcher stays as its command
in `~/.local/bin`, `~/.claude/odyssey-launch.mjs` and the folder `~/.claude/odyssey-launch/`:
delete all three.
The status bar, the helper-agent rows, the tips and peek stay in your user settings until you
remove them ([the bar, the rows and the tips](#removing-the-bar-the-rows-and-the-tips),
[peek](#removing-peek)).

## Fitting it to a repo: `/odyssey:setup`

Run it once at the root of a git repo. It shows one proposal for the project, filled in from
what it finds in `package.json` (or, without one, in the repo's own manifest and task runner)
and the folder layout, which you confirm or change; then it shows a dry run, and writes only on
your yes. It runs each gate stage it proposes once first, timing it, and leaves out one that
fails on the repo as it stands, saying why: a stage whose tool isn't installed would otherwise
block every commit. It leaves out the slowest, one at a time, until the rest take under about
500 s, since the gate has 570 s for them all, and it runs the docs check the gate runs after
them, offering to fix what it finds.
Its writes are create-only: a file the repo already has is never changed, apart from the
`.gitignore` lines below and, on a re-run, the kit's own rules it upgrades and the retired keys
it removes. It writes:

- `.claude/rules/odyssey/primary.md` — the kit's always-on rule, under 1 KB (Quickstart, step
  3), stamped `<!-- odyssey-managed v1.0.0 sha256:… -->` on its first line;
- `.claude/rules/sensitive-data.md` and `.claude/rules/hot-path.md` — your project rules, from
  your answers, each only when your answers name something for it (see below);
- `.claude/odyssey.json` — the config (see below);
- `directives/handoff/current.md` — the handoff file, empty, which sessions relay through;
- two `.gitignore` lines, `directives/handoff/` and `references/CR reviews/`, the one edit it
  makes to an existing file, keeping the handoff and the review findings out of commits.

**Outside the repo, only on your yes.** Near the end, setup offers, in one step where you
pick which, the [status bar](#the-status-bar-and-the-theme), the kit's spinner tips, the wrap-up
band and [a launcher](#the-launcher), each recommended, and [peek](#peek-experimental) and
ponytail, not. The bar, the tips and the two mods edit your user settings,
`~/.claude/settings.json`, or the one in the folder `CLAUDE_CONFIG_DIR` names; before its first
edit there, setup saves a copy beside it, `settings.json.before-odyssey`. Run again on a machine
where the bar or peek is on, setup says so and replaces its copy only when this kit version's
differs. It doesn't offer the kit's theme. The launcher goes under a name you choose: a command
in `~/.local/bin`, and the launcher itself in `~/.claude/odyssey-launch.mjs`.

**Kit-owned and project-owned.** The stamped rule, `primary.md`, belongs to the kit: re-running
`/odyssey:setup` after an update replaces it when it is untouched and out of date. A rule you
edited is kept, its diff shown, and replaced only if you approve it. A rule you deleted is
offered back the same way. To take a rule over for good, remove its stamp line: the kit then
treats it as yours. A guard hook keeps Claude's edit tools off stamped files, so project rules go
in `CLAUDE.md`. A `.claude/rules/project.md` an earlier version wrote is yours, and stays.
Everything else setup writes is yours from the start and never touched again, with one
exception: a re-run removes the retired keys `reviewers` and `layer2Owned` from
`.claude/odyssey.json`. The kit still accepts both, so an older config stays valid, and reads
neither.

**Files from earlier versions.** A re-run removes the five rule files earlier versions
installed, and an earlier version's `directives/layer_3_work_orders/` folder, each only while
untouched: the folder counts as untouched when it holds nothing but its placeholder
`current.md`. One you changed is kept, and is yours to delete when you're ready. The dry run
lists each.

**Trust.** Three hooks run code from your repo: the commit gate runs your gate stages and
`docs.check`, the typecheck gate runs the command you configure, and the formatter runs your own
Prettier and ESLint. Repo config can switch them on, but they
stay off until you approve them: setup prints one command for you to run yourself, in a terminal
or with `!` in the session. The record is keyed by the repo's path, as the file system spells
it, and the exact command text, so a repo at a new path asks again, and a changed command stops
until you approve it again. The repo and its git worktrees share one record: approving in any
of them records that checkout's commands for all of them, in place of the ones approved before.
The exception is a repo whose own checkout has a `.git` file or a symbolic link in place of
the `.git` folder (a submodule, a clone made with `--separate-git-dir`, or a `.git` linked
in from elsewhere): each of its worktrees asks again. It does not cover what the command
runs: a changed script behind the same command is not approved again. The secrets guard
keeps Claude's edit tools off the trust file, and blocks shell commands that name it or the
approve command; that second check is pattern matching, and best-effort (see Known limits).
The record is per person and per machine, and no environment variable stands in for it,
since a repo's own settings file could set one. In CI, run the approve command as a step of
the pipeline, before the session starts.

**Ponytail.** Setup offers ponytail, a separate plugin, in the same question as the status bar,
and gives its two install commands when you pick it. Why we recommend it is
[below](#why-we-recommend-ponytail).

Commit `.claude/odyssey.json`, `.claude/rules/` and `.gitignore`: the config is the project's
settings, shared with everyone who works on it.

### Status and doctor

- `/odyssey:setup status` — the hooks on in this repo, each configured command's trust, the
  config version, whether the kit-owned rule is up to date, edited or missing, any copied kit hook
  still wired in `.claude/settings.json` (it would run twice beside the plugin's), and whether a
  handoff message is waiting, without showing it.
- `/odyssey:setup doctor` — Node 22 or later; the config valid against the bundled schema, with
  nothing in it that silently does nothing: a typecheck gate that is on names its command,
  `formatOnEdit` finds Prettier, and each `srcDirs` and `testDirs` entry is a folder in the repo,
  spelled as on disk; each command a switched-on hook runs is trusted, or the approve command
  to run; no settings file turning the hooks off (`disableAllHooks`); and, for each
  guard that is on, a test call it must block; when the status bar is on, that its script is
  in place and matches this kit version; and when peek is on, that its copy is in place and
  matches this kit version, since an older copy may hold older secret-file patterns. It exits
  non-zero on any FAIL and says what fixes each one.

## The status bar and the theme

`/odyssey:setup` offers two extras for your machine, each with yes recommended: a status bar that
shows what the session is using as you work, and spinner tips about the kit. A plugin
can't switch on a status line or tips by itself, so setup asks. Both go in your user settings,
`~/.claude/settings.json`, so they show in every project on this computer and are never
committed. The kit also ships a color theme, which nothing turns on for you.

### What the bar shows

```
[ODYSSEY]  ♾  ctx ████████░░░░│░░░░░░░░ 42%  Opus 5.5 · max  plan ≈ $1.84 at API rates · handoff waiting
5h █████░░░░░░░░░░░░░░░ 24% · resets 4:10pm  1w ██████░░░░░░░░░░░░░░ 31% · resets Mon 9am
```

Here `█` is a used cell and `░` a free one; the bar itself draws used cells in the logo's cyan
and free ones in navy.

| Part | What it shows |
|---|---|
| `[ODYSSEY]` | The kit's badge. |
| `♾` | The Odyssey logo, an emoji drawn by your terminal's emoji font. |
| `ctx` | How full Claude's context window is, as Claude Code reports it. Claude Code counts input tokens only, so a reply counts once the next request sends it back. Before the first reply it reads 0%. The `│` is the wrap-up mark. |
| `Opus 5.5 · max` | The model and the effort level, as Claude Code reports them. |
| the cost | An estimate of what the session has cost so far, and who pays: see [The cost](#the-cost). |
| `handoff waiting` | Shown in gold while the repo's handoff file holds a message for the next session, which `/odyssey:handoff` reads. |
| `5h`, `1w` | How much of your plan's five-hour and weekly usage limits is used, and when each starts again in your computer's local time: the five-hour one as a time of day (`4:10pm`), the weekly one with its day (`Mon 9am`). Claude Code sends these on Pro and Max plans, and only after Claude's first reply in a session; until then the row is left out. A bar turns gold at 80%. Claude Code sends no monthly figure, so the bar shows none. |
| `spend` | Behind a Claude apps gateway that sets you a spend limit: how much of it is used, which can pass 100%, and when it starts again. Gold at 80%, like the plan's limits. |

**Rows.** The bar takes up to three rows, each only when it has something to show: the first
always; the messages (`handoff waiting` and the wrap-up hint) at the end of
the first row when they fit there whole, otherwise on a row of their own below it; and the
limits last. Claude Code cuts off whatever runs past the room it gives the status line, the
terminal's width less two columns on each side (as of 2.1.287), so on a narrow terminal the bar
shortens or drops parts to fit that room. Row by row, in this order:

- the first row: the cost drops `at API rates` (or `billed`), then the model goes, then the
  context bar shrinks to ten cells, then the cost goes, and last a status line you kept in front
  moves to a row of its own above;
- the messages: the wrap-up hint becomes `wrap up now`, then `handoff waiting` goes;
- the limits: the reset times go, the last window's first, then the bars shrink to ten cells,
  then only the first window stays.

A terminal narrower than a row's shortest form still cuts that row, and a notification Claude
Code shows at the row's right end can cut it short.

**The wrap-up mark.** Past 35%, the context bar turns gold and, in a repo setup has fitted (one
with `directives/handoff/`), the messages say `wrap up: /odyssey:wrap-up`: one command that
waits for the session's background agents, saves what this session decided, tidies the memory
index when it needs it, leaves the next one its first message, and then you start fresh. Why
35% and not later: the more the context holds, the likelier Claude is to miss or mix up
something in it; wrapping up takes room of its own; Claude Code can start compacting a
conversation automatically before the window is full, at a point that depends on the model, and
the summary that replaces it keeps less detail; and every turn sends the whole context again, so
a fuller context costs more on every turn. A lower mark means more fresh starts, each with a
start-up of its own. To move the mark, set `ODYSSEY_WRAPUP_PCT` in the `env` block of your user
settings, for example `"ODYSSEY_WRAPUP_PCT": "50"`.

**[ODYSSEY] and ponytail.** A status line you had before setup stays in front of the bar,
unchanged, with one exception: when it is ponytail's and prints ponytail's default badge,
`[PONYTAIL]`, the bar leaves that badge out and `[ODYSSEY]` stands in its place. Its
`[PONYTAIL:LITE]` and `[PONYTAIL:ULTRA]` badges still show, since they mean ponytail has changed
how Claude works. Ponytail offers its status line only when none is set, so if you install it
after the bar, it doesn't add its badge. [Why we recommend ponytail](#why-we-recommend-ponytail)
is unchanged.

### The cost

Claude Code gives the bar its own estimate of what the session has cost, at list prices. It can
differ from your bill, hence the `≈`, and it starts again at $0 after `/clear`. Claude Code
doesn't say how you pay, so the bar reads two signs:

- `plan ≈ $1.84 at API rates`: Claude Code sent your plan's 5-hour or 7-day usage, which it
  does on Pro and Max plans. Your plan covers the session; the figure is what the same work
  would cost at API prices.
- `API ≈ $1.84 billed`, in gold: the environment Claude Code gives the bar holds
  `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`, or switches on Bedrock, Vertex or Foundry
  (`CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`). That
  environment includes the `env` block of your settings. The spend is billed to that account.
- `≈ $1.84 est.`: neither sign. A Pro or Max session shows it until Claude's first reply, when
  the plan's figures arrive, and so does an API account you signed in to with `/login` while
  no key is in the environment.

On a narrow terminal the first two shorten to `plan ≈ $1.84` and `API ≈ $1.84`.

### Helper-agent rows

The same setting gives each helper agent (subagent) a row in the bar's style, in the panel under
the prompt:

```
Fix round 2 · Opus 5.5 · ctx ███░░░░░░░ 31%
```

Each row shows the agent's name when it was given one, what it was asked to do, the model it runs
on, its effort level when the agent or the request sets one, and how full its context window is.
A task that isn't an agent, such as a background shell, keeps Claude Code's own row. An agent
that sets no effort runs at your session's and shows none.

### Spinner tips

While Claude works, Claude Code shows a tip in the spinner line. Setup offers these about the kit,
added to Claude Code's own tips, which stay:

- Ending a session? `/odyssey:wrap-up` saves what this session decided and learned to memory,
  then writes the next session's handoff.
- Something broke? `/odyssey:heal-me` builds a check that fails on the bug, makes the fix with a
  regression test, and records what was learned.
- `/odyssey:setup status` shows which of the kit's hooks are on in this repo, and whether a
  handoff is waiting.
- CodeRabbit reviewed your PR? Run `/odyssey:cr-triage` with its number: it checks each finding
  against the code and accepts, rejects or defers it, or reports the PR ready to merge.
- A process you keep explaining? `/odyssey:create-directive` writes it down in `directives/`
  from the kit's template: its goal, inputs, outputs, steps and edge cases.
- The kit's secrets guard blocks Claude's writes to `.env` files, private keys and other secret
  files. To protect more, add patterns to `protect.secrets` in `.claude/odyssey.json`.

They're in your user settings under `spinnerTipsOverride`, each with an `id` that starts with
`odyssey-`.

### The Odyssey theme (optional)

The kit ships a color theme, Odyssey, made for dark terminals. Nothing turns it on: setup doesn't
ask about it, and Claude Code keeps the theme you use. To try it, run `/theme` and pick Odyssey,
marked as from the odyssey plugin; to go back, run `/theme` again. On a light background, keep a
light theme: there is no light version.

Each color has one job. Cyan and blue are Claude itself: the spinner, the prompt border, the
start-up mascot. Gold means something changed how Claude behaves: auto-accept, bash mode, fast
mode, warnings. Teal is done: success, merged. Rose red is errors. Claude Code's ultracode
rainbow and its helper-agent colors stay as Claude Code ships them, so they still stand out and
stay apart. The text colors were checked for contrast against black and against Windows
Terminal's default background, and all but the deliberately faint one clear the usual 4.5:1;
the warning and error colors were checked under a simulation of red-green color blindness.

The theme recolors Claude Code itself, not text a status-line script colors on its own: the bar
keeps its colors under any theme.

### If the colors look banded

Over SSH, the bar's colors can show in steps instead of smooth shades: by default ssh doesn't
pass `COLORTERM` on, and the colors are then rounded to a 256-color palette. If your terminal
shows full color, as most current ones do, add `export COLORTERM=truecolor` to the shell
startup file (such as `~/.zshrc`) on the machine where Claude Code runs.

### Why it doesn't move

Claude Code redraws a status line when something happens, such as a new reply or a change of
permission mode, and on a timer only if you set one, never more than once a second. Any
animation would show as jumps, so the bar stays still.

### What it reads and runs

The bar reads what Claude Code passes it, and the repo's handoff file only to see whether it
holds anything. It runs the status line you had before, if any, and nothing
else. It writes nothing and sends nothing anywhere. It's one Node script for the bar and the
rows, which setup copies to `~/.claude/odyssey-statusline.mjs`: a copy, so it keeps working when
the plugin updates. Setup replaces it whenever this kit version's copy differs, so don't edit
it. `/odyssey:setup doctor` checks that it's there and current.

### A ping when Claude needs you

Not part of the bar, but useful on long runs: Claude Code can ring the terminal bell when
Claude finishes or a permission prompt is waiting. Set `"preferredNotifChannel":
"terminal_bell"` in your user settings (in `/config`, Local notifications). The kit doesn't set
it. Over SSH the bell travels with the rest of the output, so it reaches the terminal you're
looking at; what that terminal does with it, a sound or a flash, is its own setting.

### Removing the bar, the rows and the tips

They stay when you turn the plugin off or uninstall it, since they live in your user settings.
Remove them before you uninstall, while the kit's script is there, from any folder:

```
node <the kit's folder>/scripts/odyssey.mjs bar remove
node <the kit's folder>/scripts/odyssey.mjs tips remove
```

`bar remove` puts back the status line you had before setup, takes the bar out of `statusLine`
and `subagentStatusLine`, and deletes `~/.claude/odyssey-statusline.mjs` and its `.prev` file.
`tips remove` takes out each tip whose `id` starts with `odyssey-`, keeping your own. If you set
`ODYSSEY_WRAPUP_PCT` in the `env` block, delete it yourself. Your settings as they were before
setup's first edit are in `~/.claude/settings.json.before-odyssey`.

## Peek (experimental)

Peek shows a file in a pane inside Claude Code, so you can read it without leaving the session.
`/odyssey:setup` offers it. It needs Claude Code 2.1.288 or newer.

- `/peek <path>` shows a file from this repo or one of its worktrees: Markdown, code with line
  numbers, CSV as a table, JSON, the text of a PDF or Word file, a picture as a preview drawn in
  colored blocks, and an audio file's details with its waveform. `/peek <path>:<line>` opens at
  that line.
- `/peek` alone lists the files this session touched and the repo's newest, with a filter box
  over all of its files. `/peek diff` lists the files changed since the last commit and shows
  each one's diff.
- `/peek allow <folder>` lets it show a folder outside the repo, after you say yes;
  `/peek disallow <folder>` takes that back. It won't approve the top of a drive, your home
  folder or one that holds it, a system folder or one every user shares (such as `/tmp` itself),
  a key folder (`~/.ssh`, `~/.gnupg`, `~/.aws`), or Claude Code's own folder. Started in such a
  folder, or in a repo that is one, peek shows nothing from it and says why.
- In a file, `e` puts `In <path>: ` in the prompt for you to say what to change; Claude makes
  the change with its usual tools, in one turn. After Claude writes or edits a file, a line
  above the prompt offers `1` to open it and `2` to show its diff.

**Secret files.** Peek refuses every file the secrets guard protects (its list, plus your
`protect.secrets`), and a link that leads to one. The one exception is a `.env` file, which
opens in an editor that masks every value (`v` shows the selected one); the values stay in that
pane until a save, which writes them to the `.env` file through a temporary file beside it, in
a folder only you can open on macOS and Linux. Peek reads the patterns from a copy of the guard
in its own folder and refuses every file while that copy is missing.

**What it runs.** Git, to list files and diffs; `pdftotext` for PDFs, and `ffmpeg` and
`ffprobe` for pictures, audio and video, when they're installed; on macOS, its own `sips`,
`afinfo` and `textutil`; and, to save a `.env`, `mktemp`, `chmod` and `mv`, or PowerShell on
Windows.
Each runs by its arguments, with a time limit, never through a shell. When a reader is missing,
peek names the command that installs it.

**How it's installed.** Peek is a mod, a plugin whose hooks run inside Claude Code and draw on
its screen. It loads from a folder named in `CLAUDE_CODE_PLUGIN_DIRS`, the list of plugin
folders Claude Code reads when a session starts, so peek starts with your next session. Setup
runs `scripts/odyssey.mjs mod install peek`, which copies peek and the guard to
`~/.claude/odyssey-peek` and adds that folder to the list in the `env` block of your user
settings, after the folders already there (on Windows the list is separated by `;`, elsewhere by
`:`). A list set only in the environment Claude Code starts from gives way to the one in your
settings, so the script names those folders for you to add. `mod status peek` says whether it's
on and current. Re-running setup replaces the copy when this kit version's differs, which is how
peek's secret-file patterns follow the kit's.

### Removing peek

Run `node <the kit's folder>/scripts/odyssey.mjs mod remove peek`, where the kit's folder is the
`installPath` that `claude plugin list --json` shows for `odyssey@odyssey-ai`. It takes
`~/.claude/odyssey-peek` out of `CLAUDE_CODE_PLUGIN_DIRS`, deleting the key when nothing else is
left in it, and deletes the folder. By hand, it's those two steps. Peek's approved folders stay
in its own store under Claude Code's folder.

## The launcher

A command you run instead of `claude`, one per repo, under the name you give it at setup. It
opens the repo in Claude Code from any folder. Once a session passes the wrap-up mark
(`ODYSSEY_WRAPUP_PCT`, 35% unless you set it), the kit asks Claude to run `/odyssey:wrap-up`,
which waits for the session's background agents, saves memory, tidies the memory index when it
is past its size target, and writes the handoff. The launcher then ends that session and starts the next with
`/odyssey:handoff`, which reads the handoff and carries on. Run `/odyssey:wrap-up` yourself at
any point and the launcher picks it up the same way.

```
ma                                # opens with /odyssey:handoff when a handoff or timer waits
ma "fix the flaky checkout test"  # or with your own first prompt
```

It runs `claude` from your PATH, not a shell alias, and takes a first prompt only: it refuses
claude's own flags (`--model`) anywhere on the line, since the sessions after a wrap-up would
start without them, so quote a prompt that holds a word starting with `-`, as in
`ma "use --force here"`. Set what every session needs in `~/.claude/settings.json` instead
(`permissions.defaultMode`, `model`, `remoteControlAtStartup`).

What it needs, and what it doesn't do:

- **The status bar.** Claude Code tells the status line how full the context is, and the bar
  passes that on to the kit's Stop hook. Without the bar, wrap-up never starts by itself: run it
  yourself, and the launcher still starts the next session.
- **Permissions.** Claude still stops for anything your permission settings ask about. For work
  that runs unwatched, allow what it needs first.
- **Stopping.** Quit Claude Code without wrapping up (`/exit`, or Ctrl+C twice), and the
  launcher ends with it. After three sessions in a row that each wrapped up within 5 minutes of
  starting, likely each started past the mark, it stops and says why.

Setup writes the command to `~/.local/bin` and refuses a name your shell already knows. When that
folder isn't on your PATH, it prints the line that adds it for your shell, and the full path to
run until you open a new terminal. `/odyssey:setup status` names the repo's launcher. To remove
it, run `node <the kit's folder>/scripts/odyssey.mjs launcher remove <name>` in the repo.

## Wrap-up (optional)

Once a session's context passes the status bar's wrap-up mark, `ODYSSEY_WRAPUP_PCT` (35% unless
you set it), a band above the prompt says "Context 72% used" and offers **Wrap up** (key `2`)
and **Not now**. Wrap up runs one command, `/odyssey:wrap-up`, which you can also type yourself:
it stops the session's scheduled jobs and waits for its background agents to report, saves the
session's memory, tidies the memory index when the index is past its target, then writes the
next session's handoff. It asks only when the handoff slot already holds another session's
message. The band shows only in sessions that loaded the kit, never over a survey, and not again
in that session after either button. In a session the [launcher](#the-launcher) started, the
kit starts wrap-up by itself.

`/odyssey:setup` offers it. Like peek, it's a mod: it loads from `~/.claude/odyssey-wrap-up`, a
folder `CLAUDE_CODE_PLUGIN_DIRS` in your user settings names, so it needs Claude Code 2.1.288 or
newer and starts with your next session. To remove it, run
`node <the kit's folder>/scripts/odyssey.mjs mod remove wrap-up`.

## The config: `.claude/odyssey.json`

What the kit runs or matches on, in one committed file. Only `version` is required; every other
key has a default, and an unknown key is an error, so a typo shows up in `doctor`. An invalid
file switches the opt-in hooks off and shows one notice, so a bad config never locks a session.

| Key | Holds | Default |
|---|---|---|
| `version` | The config format, `1` | required |
| `$schema` | The schema's URL, for editors; setup writes it | — |
| `project` | The project's name | none |
| `srcDirs`, `testDirs` | Source and test directories | `["src"]`, `["test"]` |
| `gate.stages` | The stages `/odyssey:local-gate` runs, and the commit gate before each commit, each `{ "name", "command" }` | for local-gate, the `package.json` scripts; the commit gate needs them named |
| `gate.fix` | The auto-fix commands its `fix` mode runs first | none |
| `db.schemaFile`, `db.seedFile`, `db.generate`, `db.migrate`, `db.seed` | The migration flow `/odyssey:db-migration` drives | none: the skill says there is no migration flow |
| `docs.plan` | A plan outside `docs/plans/`, which make-a-path and what-next read too | none |
| `docs.check` | The repo's own docs check, which the gate's docs stage runs after the kit's | none |
| `protect.secrets` | Extra secret-file patterns, added to the guard's defaults | none |
| `protect.manifests` | Extra dependency manifests, added to npm's | none |
| `protect.readOnly`, `protect.appendOnly` | File names only a human edits; file names Claude may only append to | none |
| `hooks.protectManifest`, `hooks.protectAppendOnly`, `hooks.formatOnEdit`, `hooks.esmImportExtension`, `hooks.loadLog` | The opt-in hooks' switches | off |
| `hooks.commitGate` | `false` turns the commit gate off | on when `gate.stages` is set |
| `hooks.typecheckGate` | `{ "enabled", "command", "timeoutSec" }` | off; `timeoutSec` 300 |

```json
{
  "$schema": "https://raw.githubusercontent.com/OdysseyStack/oncewright/main/schema/odyssey.v1.json",
  "version": 1,
  "project": "shop",
  "srcDirs": ["src"],
  "gate": { "stages": [{ "name": "typecheck", "command": "npm run typecheck" }, { "name": "test", "command": "npm test" }] },
  "protect": { "appendOnly": ["journal.md"] },
  "hooks": { "protectManifest": true, "protectAppendOnly": true, "typecheckGate": { "enabled": true, "command": "npx tsc --noEmit" } }
}
```

The schema ships in the plugin (`schema/odyssey.v1.json`), so `doctor` validates offline.

### Project rules

What Claude should know about the project lives in rules, not in the config:

- **`.claude/rules/sensitive-data.md`** — the categories and field names this project must
  never log, never a value, and where its credentials live, with the rule for reading one:
  confirm it is set, never print it. Always loaded.
- **`.claude/rules/hot-path.md`** — its `paths:` frontmatter names the latency-critical files,
  so it loads only when Claude works on them, and its body holds their invariants.

Setup writes each only when your answers name something for it. Everything else about the
project goes in `CLAUDE.md`, which is yours.

The kit's own rule is one file, `.claude/rules/odyssey/primary.md`, under 1 KB: scope, deciding
instead of asking, git, and how a reply ends. Its git rule holds the one approval given ahead:
while a PR is open, commits to that PR's own branch and normal pushes go ahead, never to the
default branch and never a force-push, a merge or a rebase. What a script can check is a hook
instead of a rule: the commit gate runs the gate before each commit, and the zsh guard blocks
the shell syntax Claude Code's safety check refuses ([Hooks](#hooks)).

## Who does what

The kit runs on three layers (Nick Saraev's DOE model — see Credits):

- **Layer 1 — Directive: you and your SOPs.** The directives in `directives/` say what to do,
  and you own them: you set the goal, make the calls only a human should make, approve git
  operations, and merge. Work "handed back to Layer 1" comes back to you.
- **Layer 2 — Orchestration: the sessions.** Plan, grill, triage review findings, and make
  planned changes and one-off requests directly (below), in the session or in an agent given a
  direct brief.
- **Layer 3 — Execution: the scripts and checks.** The repo's own scripts that a directive
  names, the gate's stages, the kit's hooks and `scripts/odyssey.mjs`: code that does the same
  thing every run, so the sessions above decide and the scripts do.

**How work is made.** Work that comes from a plan or a scoping document is made directly in the
session that reads it: Claude names the files the plan's slice names, with their tests and any
file the repo's own instructions require for that change, before the first edit and stays
inside them. A file the slice doesn't name is changed only after you
say yes; otherwise Claude reports it as found, not fixed, and its reply names any file changed
outside the list. A finished slice is marked done in its plan, and the commit message records
what changed and why. Open choices are decided, not asked about, unless a wrong guess would be
costly to undo. Before each commit Claude makes, whether in the session or in an agent, the
commit gate runs the repo's gate with every stage to the end, its docs stage included. The hooks
apply to all of it.

## Checkpoints: why every step starts fresh

This is the idea the whole kit is built on. **Every stage ends by writing its result to a
file, and the next stage starts in a fresh or cleared session, or an agent with a fresh
context, that reads that file.** The plan
lives in `docs/plans/`. Review findings and their verdicts live in `references/CR reviews/`.
Decisions live in memory
(`/odyssey:remember-session`), and the next session's opening message lives in
`directives/handoff/current.md`, with the last one read kept beside it as `previous.md`.

Nothing depends on a session remembering a previous chat. Each session gets a full, fresh
context window and works from verified files instead of a long transcript, which leaves far
less room for drift and hallucination than pushing millions of tokens through one marathon
session. A checkpoint is also a record: the plan stays in git, the review findings and their
verdicts stay in `references/CR reviews/`, and each commit message says what changed and why,
so when something goes wrong you can see which file said what. The handoff is the one file
cleared once it is read.

## Finding your place: make-a-path and what-next

Two skills read where the repo stands, from its files and git, and write nothing:

- **`/odyssey:make-a-path`**: where you are with the work in front of you, and the one command
  that moves it on: a handoff to read, findings to triage, a branch to push,
  a plan to grill or its next slice. It prints **Here**, **Next**, at most two **Also** lines, and
  where the step should run.
- **`/odyssey:what-next`**: for when you've lost your place across sessions. It lists every open
  thread with the file it came from (uncommitted and unpushed work, unmerged branches, active
  plans, open grilling questions, deferred CodeRabbit findings, the CHANGELOG's unreleased
  section, the last handoff's open flags) and ranks three to pick up.

Their scripts, `odyssey.mjs next` and `odyssey.mjs open`, give the same answer every time for
the same repo. The skills add open pull requests through `gh` when it is installed.

## How the cycle works

1. **Brainstorm.** Shape the idea with `/superpowers:brainstorming` (from the superpowers
   companion pack, below) before anything is written down.
2. **Plan.** Write the plan in `docs/plans/`.
3. **Grill.** Stress-test the plan with `/odyssey:grill-me` before any work starts. It asks one
   question at a time and writes each answer into the plan's `## Grilling record` before the
   next question, so a grilling cut short picks up where it stopped. Answers that change the
   plan go back into it.
4. **Make each slice.** Each slice of the plan is made directly, in the session or in an agent
   given a direct brief (see [Who does what](#who-does-what)): its files named before the first
   edit, test-first with `/odyssey:prove-it` where it fits, and, when you want a second look,
   `/odyssey:review-me` against the repo's standards and the plan. The commit gate runs the
   gate before the commit, every stage to the end. Commits wait for your
   go, and so does the first push of a new branch.
5. **Pre-push review (new branches).** Before that first push, Claude runs CodeRabbit's CLI
   locally on the committed branch (`coderabbit review --committed --base <default branch>`)
   and fixes what it finds. Nothing upstream is watching yet, so mistakes get caught before the
   push opens a PR, and CodeRabbit's PR reviews — which count against your plan's review
   limits — start from a cleaner first commit. Once a PR is open, skip the CLI: the PR bot
   reviews every push, and running both reviews the same diff twice.
6. **Review loop.** Push, open the PR, and run `/odyssey:cr-triage` on it after each CodeRabbit
   round (details below). The accepted fixes are made directly, pass the gate and are pushed to
   the PR's branch without pausing, and the loop repeats until the PR is ready to merge. You merge it, or ask triage to
   merge it once it's ready (see "What triage does").

Around the cycle:

- **Between sessions.** `/odyssey:handoff write` leaves the next session its opening message,
  and `/odyssey:handoff` picks it up. `/odyssey:remember-session` saves the decisions to memory,
  and `/odyssey:index-it` keeps that memory tidy. Claude Code loads only the first 200 lines or
  25 KB of the memory index, `MEMORY.md`, so once it passes 150 lines or 16 KB,
  remember-session runs index-it itself, which proposes a restructure for you to apply.
- **Docs that drift.** Every gate run has a docs stage, the kit's docs check
  (`scripts/odyssey.mjs docs check`), a script that costs no model tokens. It finds the repo's
  instruction files by walking the repo, git-ignored ones included, with the files they import,
  says when Claude Code loads each one, and checks their claims: every import and every path
  they name exists, every `npm run` names a real script, every ADR they cite exists, and no
  skill or agent under `~/.claude` shadows one of the repo's own. The repo's own docs check
  (`docs.check`) runs after it in the same stage. Your own files under `~/.claude` and the
  managed ones are listed, never edited. A repo with no docs skips the stage.
- **What Claude is told.** `/odyssey:audit`, which you start, answers three questions about the
  instruction files: which ones Claude Code loads and when, beside the load log
  (`hooks.loadLog`) of what did load; which rules sit in files that never load; and which claims
  the code disproves and which rules contradict each other. It reports each finding with its
  fix, and edits nothing.
- **When something breaks.** `/odyssey:heal-me` builds a check that fails on the bug before
  guessing at causes, then makes the fix directly, with a regression test.
- **A new procedure.** `/odyssey:create-directive` writes a Layer 1 SOP into `directives/`.
- **Schema changes.** `/odyssey:db-migration` generates, reviews and applies a migration with
  the tool in `db.*`, against a local database only. You run it yourself; a schema change you
  describe to it is made directly and recorded.

### The review loop in detail

One round of review runs in two steps. Each can be its own fresh session, and the only thing
passed between them is a file:

| Step | You run | It reads | It writes |
|---|---|---|---|
| 1. Triage | `/odyssey:cr-triage #N` | the PR and CodeRabbit's latest review | `references/CR reviews/pr<N>-<slug>-round<K>.md` and its `.md.resolved` sibling |
| 2. Fix | a request to make the accepted fixes in the `.resolved` file | the `.resolved` verdicts and the findings file | the fix commit, pushed to the PR |

**What triage does.** `/odyssey:cr-triage #N` waits for CodeRabbit to finish reviewing the
latest push (it usually takes 3–4 minutes), then checks whether the PR is ready to merge: no new
actionable findings since the last round, every nitpick, outside-diff comment and non-LGTM
"additional comment" disposed, each accepted one fixed in a commit CodeRabbit has since
reviewed, no answer from CodeRabbit to one of triage's replies that leads triage to change a
verdict, CodeRabbit's status passing and described "Review completed", CI green, a clean merge
state, and no unresolved thread but a deferred finding's. A run that failed still shows a
passing status, so triage reads the status's description too, and asks CodeRabbit for a full
review when the run failed. If the PR is ready, triage says so and stops; it merges only when
you asked it, in that session, to merge that PR once it's ready.

If it isn't, triage writes two files:

- **The findings file** — `references/CR reviews/pr<N>-<slug>-round<K>.md`. Every finding
  verbatim (file, lines, severity, body), inline findings first, then the review's nitpicks,
  its comments on lines outside the diff and its "additional comments" other than a bare
  `LGTM!`, each under a heading of its own, plus a `Source:`
  line naming the CodeRabbit review it came from.
  The next round uses that line to know where the last one ended.
- **The disposition** — the same path plus `.resolved`. For each finding: the verdict (accept,
  defer or reject), the reasoning checked against your ADRs, `CLAUDE.md` and vendor docs (and a
  test's result, when one cheap run settles a claim), and a disposition table.

Triage also fills in the PR description from what it verified, then names the next step.
It changes no code, and the only git it runs are the reads that change nothing, unless you ask
it to make the fixes itself (below).

**What the verdicts mean.** An **accepted** finding is fixed in step 2. A **deferred** finding
stays in the `.resolved` file with the phase it belongs to, and `/odyssey:what-next` lists it
until then. A **rejected** finding keeps its reason in the `.resolved` file and in the reply on
its thread; nothing is written into the code.

**The replies on GitHub.** Once a round is done, triage answers each inline finding's thread on
the pull request in one line: `Accepted — fixed in <sha>: …`, and resolves the thread;
`Declined — …` with the reason, and resolves it; or `Deferred to <phase> — …`,
without resolving it. Nitpicks sit in the review's body, not in threads, so they get no reply. The
findings file and the `.resolved` stay on your machine. CodeRabbit answers replies on its own
threads unless its `chat.auto_reply` setting is off, and can save what one says as a learning
that shapes later reviews. When it saves one under a rejection or a deferral, triage says so:
someone with CodeRabbit's Admin role can edit or delete it at app.coderabbit.ai/learnings.

**The `.resolved` file is the fixer's entire input.** Step 2 can start cold, from only that file
and the findings file, so the disposition has to stand on its own.

### CodeRabbit setup

The kit ships no `.coderabbit.yaml`: that file describes your project, so you write it. Any
change Claude makes to it waits for your sign-off on its exact text, since it changes what
every later review sees.

Three settings help the review loop; merge them into the file:

```yaml
reviews:
  auto_review:
    auto_pause_after_reviewed_commits: 0
  path_instructions:
    - path: ".claude/skills/**"
      instructions: |
        A skill: the steps an agent follows for one task. Most rules in it restate
        a home file, such as CLAUDE.md, a rule under .claude/rules/ or package.json.
        Raise a finding only for (1) a statement that contradicts its home file, or
        allows or forbids more than the home does, naming the home file and line;
        and (2) a path, command or script name that doesn't exist, or a command
        described with an effect it doesn't have. Hold the review to the lines this
        PR changes and to restatements of a rule this PR changes elsewhere, and
        leave wording and structure as written.
knowledge_base:
  learnings:
    scope: local
```

- `auto_pause_after_reviewed_commits: 0`: by default CodeRabbit pauses automatic reviews of a
  pull request after five reviewed commits, and triage stops when reviews are paused, so a long
  review loop would stop there. Every push is then reviewed, and each is a review against your
  CodeRabbit plan: past its included reviews, a plan with usage-based reviews on bills each
  reviewed file. The fixer pushes each round once; set a spending cap in CodeRabbit's billing
  settings to bound a long loop.
- The skill files' review: a skill that restates a rule differently from the file that defines
  it changes what an agent does, and so does a step naming a command that doesn't exist. The
  entry leaves wording alone: a full review of such files once took a single pull request ten
  rounds. Add the same entry for any other folder of instructions you keep, such as
  `.claude/agents/**`.
- `learnings.scope: local`: a learning CodeRabbit saves from a reply in this repo shapes only
  this repo's reviews. The default, `auto`, gives a private repo the whole organization's
  learnings.

### Running it by hand (the default) or automated

**Automation exists, but it is off by default.** Out of the box, every step of the cycle stops
and hands back to you. That keeps each checkpoint in your hands and each
session fresh.

**By hand, one review round looks like this:**

1. In a session, run `/odyssey:cr-triage #N`. It ends by naming the `.resolved` file, which
   lists each finding and what to do about it.
2. Have the fixes made: tell that session to make them, or open a fresh one and ask it to make
   the accepted fixes in the `.resolved` file. It makes each fix directly, runs the gate, then
   commits and pushes to the PR's branch.
3. After CodeRabbit reviews the push, go back to step 1 for the next round.

To carry context across a break, end a session with `/odyssey:handoff write` and start the
next one with `/odyssey:handoff`. The [launcher](#the-launcher) does both at the wrap-up mark.

**Automated:** to skip the copy-and-paste between steps, say so in one line when you
start triage:

> automate #N until it's ready to merge

`/odyssey:cr-triage` then chains the steps itself, round after round: it triages, hands the
`.resolved` file to one fixer agent, which makes the accepted fixes, runs the gate and
pushes, then waits for CodeRabbit's next review and repeats. You don't write handoff messages or paste file paths.
It still stops for you when:

- the fixer stops with a question,
- the gate won't go green,
- the git state is unexpected, or CodeRabbit is paused, skipped, or hasn't reviewed within
  about 10 minutes,
- or the PR is ready to merge — merging is yours, unless you asked triage, in that session, to
  merge that PR once it's ready.

The fixes run in an agent with a fresh context, and the triage session keeps only its report,
so a long automated run stays light. An agent can't ask you anything: when the fixer stops with
a question, the triage session asks you for it. The fixer runs under your session's permission
mode, and a permission prompt from it comes to your session.

**Which model runs each step.** Every step runs on the model and effort of the session it runs
in, and the kit sets neither: in an automated chain, the fixer agent runs on the model and
effort of the session that starts it, so a chain stays on the model you chose unless you name
another. Open each session on the model you prefer. To run the fixer on another model,
name the model when you ask for the run, and Claude passes it when it starts the agent; setting
`CLAUDE_CODE_SUBAGENT_MODEL` instead picks one model for every agent that names none. The fixer
takes its session's effort, so set it with `/effort` before the run.

## Hooks

Ten hooks, each its own process, wired in exec form (`node <script>`, no shell), so they start
the same way on macOS, Linux and Windows. Four are always on: the two file guards, the
session-start hook, and `bash-guard`'s zsh guard. `bash-guard`'s commit gate is on wherever the
config names gate stages; `wrap-up-stop` acts only in sessions the launcher started; the rest
are switched on per repo in `.claude/odyssey.json`. None adds to Claude's context until it
fires.

| Hook | Fires | Does | On | When it fails |
|---|---|---|---|---|
| `session-start` | when a session starts, resumes, is cleared or is compacted | tells Claude, before its first turn, that the session was compacted or that a handoff message is waiting, without reading the message to it; and shows you a line for a waiting handoff, except after a compaction | always | open |
| `load-log` | when Claude Code loads an instruction file: a `CLAUDE.md`, a rule, or a file one of them imports | writes one line naming the file, the session and why it loaded to `~/.claude/odyssey-loads/`, which the docs check and `/odyssey:audit` read; past 256 KB the log starts over. An `AGENTS.md` that Claude Code reads without an import sends no load event, so the log never lists it | `hooks.loadLog` | open: Claude Code ignores its result |
| `protect-env`, the secrets guard | before Edit, Write, MultiEdit, NotebookEdit, Bash, PowerShell and the MCP file tools | blocks a write to a secret file, and keeps Claude's tools off the trust file and the approve command | always | closed: an error inside it blocks |
| `protect-managed` | before Edit, Write, MultiEdit, NotebookEdit | blocks edits to a file `/odyssey:setup` stamped | always | open |
| `bash-guard` | before Bash and PowerShell | the zsh guard: blocks a Bash command that uses zsh's `${(P)…}` or `${(f)…}`, which Claude Code's safety check refuses, and names the plain test to use. The commit gate: before a `git commit` (`git -C <dir> commit` and a commit in a chain included), runs `gate.stages` and the docs stage, every one to its end, once trusted, and blocks the commit with the failing stages' names and the end of their output; a green gate is silent | the zsh guard always; the commit gate when `gate.stages` is set, unless `hooks.commitGate` is `false` | open |
| `protect-manifest` | before Edit, Write, MultiEdit, NotebookEdit | blocks hand edits to `package.json`, the npm, yarn and pnpm lockfiles, and `protect.manifests` | `hooks.protectManifest` | open |
| `protect-append-only` | before Edit, Write, MultiEdit, NotebookEdit | blocks any edit to `protect.readOnly`, and anything but an append to `protect.appendOnly` | `hooks.protectAppendOnly` | open |
| `post-edit` | after Edit, Write, MultiEdit | formats the edited file with the repo's own Prettier and ESLint (`hooks.formatOnEdit`, once trusted), then flags relative imports without a `.js` extension in TypeScript under `srcDirs` and `testDirs` (`hooks.esmImportExtension`) | each switch | open |
| `wrap-up-stop` | when Claude stops, in a session the [launcher](#the-launcher) started | past the wrap-up mark, asks Claude to run `/odyssey:wrap-up`, never twice in a row; after wrap-up's last step, tells the launcher to start the next session, once no background agent, workflow, teammate or shell task is still running | in sessions the launcher started | open |
| `typecheck-gate` | when Claude stops while the working tree holds uncommitted TypeScript changes under `srcDirs` or `testDirs` | runs `hooks.typecheckGate.command`, once trusted; errors send Claude back to fix them, with the end of a long report kept, and a second failure yields to you. A change committed before the stop is not checked here: the commit gate covers commits | `hooks.typecheckGate.enabled` | open |

**Fail closed, fail open.** Claude Code lets a call through when a hook crashes, can't start (no
`node` on the PATH) or times out. The secrets guard catches every error itself and blocks, so an
unreadable payload or an unresolvable path is a block, not a pass. The others fail open: on an
error of their own they let the call through without a message. An invalid config, or a start
folder that can't be read, is announced once per session; the opt-in hooks are then off and the
secrets guard keeps its default patterns, so neither locks a session. Timeouts are explicit: 10
seconds for the guards, the session-start hook, the load log and `wrap-up-stop`, 30 for `post-edit`, the
typecheck gate's own `timeoutSec` (default 300, at most 590) under a 600-second ceiling, and 570
seconds for all the commit gate's stages together, under the same ceiling. A typecheck gate that
times out lets the turn end and says so; a commit gate stage still running at its limit fails
the gate, so the commit waits.

**Runs fully offline.** No hook sends anything anywhere. The network access in the kit is what
you run yourself: `gh`, CodeRabbit's CLI, and your own gate commands. An editor that fetches the
`$schema` URL is the editor's doing.

**Subagents too.** Hooks fire on the tool calls of subagents, a fixer agent's included.

**Tests.** Each hook, the setup script and the status bar have tests under `hooks/` and `scripts/`, run with
`node --test "**/*.test.mjs"` from the plugin root (`node --test hooks/protect-env.test.mjs` for
the guard alone). Peek's tests run with `claude plugin test mods/peek`. CI runs both on macOS,
Linux and Windows, the first on Node 22 and 24.

### The secrets guard

**Files it protects**, in edits and commands alike, whatever the letter case: `.env*` except the
`.example`, `.sample`, `.template` and `.dist` templates; `*.pem`, `*.key`, `*.p12`, `*.pfx`;
`id_rsa*`, `id_ed25519*`, `id_ecdsa*` except `*.pub`; `.aws/credentials`, `.netrc`, `.pypirc`,
`credentials.json`, `secrets.yaml`, `secrets.yml` and `secrets.json`. `protect.secrets` adds
patterns (`.npmrc`, say, `config/*.local.yaml`, or `**/*.secret`, where `**/` stands for any
number of folders, none included) and never removes one.

**Two branches, two guarantees.** For Edit, Write, MultiEdit, NotebookEdit and the MCP file
tools (`write_file`, `edit_file`, `move_file` and `edit_block`, through their `path`,
`filePath`, `file_path` and `destination` fields) the check is exact: it resolves the path to
the file a write would land on, so a symlinked file or folder can't disguise a `.env`, and a
`.env` that links to an innocent name is blocked too. For Bash and PowerShell it is pattern
matching on the command string, and best-effort by construction. It reads redirections, `tee`,
`touch`, `truncate`, the destination of `cp`, `mv`, `install`, `ln`, `rsync` and `scp` (a copy
into a folder included, whether its name ends in a slash or names a folder that exists in the
session's working folder),
`sed -i`, `perl -i`, `ruby -i`, `dd of=`, a tool's own output flag (`openssl -out`, `curl -o`,
`wget -O`, `gpg --output`, `ssh-keygen -f` and the like, alone or closing a run of short flags,
as in `curl -sSLo`), and in PowerShell `Set-Content`, `Add-Content`, `Out-File`, `Tee-Object`,
`Copy-Item`, `Move-Item`, `Rename-Item`, `New-Item`, their aliases,
`Invoke-WebRequest -OutFile`, `>` and `>>`, and the .NET file writes. A quoted argument that
holds `;`, `|`, `&` or parentheses stays one argument, and a command continued over several
lines is read as one: a line ending in a backslash in Bash, or a backtick in PowerShell. Reading
a secret is left alone: the rule is about writing them. How Claude reads one without printing it
is a rule, not a hook: the credentials section of `.claude/rules/sensitive-data.md`, which
`/odyssey:setup` writes. The guard errs toward blocking, so a command that merely quotes one of
these writes is blocked with it; make such an edit through the Write tool, whose branch reads
the real path.

### Threat model

The secrets guard is a guardrail against Claude's mistakes in a workspace you trust. It is not
a boundary against a model or a repo set on getting around it, and it guards neither the
plugin's own files nor Claude Code's settings. The known ways around it:

- **`bypassPermissions` mode**, where nothing stops Claude from writing the settings that switch
  hooks off. In the default modes that write is refused or asks you.
- **A repo's own `.claude/settings.json`**, which can set `disableAllHooks`. In `claude -p`
  runs a repo's committed settings apply without a trust prompt.
- **An edited hook script** in the plugin's installed copy, or an edited file in peek's copy,
  `~/.claude/odyssey-peek`, whose code runs inside Claude Code with no guard checking it;
  `/odyssey:setup doctor` fails a peek that differs from the kit's.
- **Interpreter one-liners** (`node -e`, `python -c`) that open a secret file themselves, which
  the command branch can't see.

To enforce a guard across an organization, use Claude Code's managed settings: they can limit
hooks to those from managed settings and force-enabled plugins, and a repo or a session can't
turn them off. `/odyssey:setup doctor` reports a `disableAllHooks` setting when it finds one.

### Known limits

What the command branch leaves open, beyond the one-liners named above: a path in a variable
(`f=.env; echo x > "$f"`); archive extraction; recursive copies of `.ssh` or `.aws`;
`git restore`, `git checkout` and `git stash`, which write files git tracks; `awk -i inplace`;
CLIs that write secrets without naming a file (`vercel env pull`, `aws configure set`); quote
splicing (`echo x > .e""nv`); `scp host:.env .`; an output flag that closes a run of short
flags with its value attached (`curl -sSLo.env`); `git add` and `git commit`, which the guard
does not read; and a symlink chain whose middle link has a secret name
(`notes.txt → .env → settings.txt`). Each reopens if it turns out to be a common vector.

The check that keeps shell commands off the trust file and the approve command is the same
pattern matching: a command that builds either name from a variable or a wildcard passes it.

The other three guards check Claude's edit tools only, so a shell command that writes the same
file passes them. The secrets guard checks four MCP tool names (`write_file`, `edit_file`,
`move_file` and `edit_block`); an MCP server that writes under another tool name is not
checked.

Every hook reads the config of the folder the session started in, with two exceptions for
another checkout of the same repo (a linked git worktree, or the repo's own checkout seen from a
session started in one): `post-edit` reads the config of the checkout the edited file is in, and
the typecheck gate checks the checkout Claude's current folder is in. The gate follows that
folder only, so a TypeScript file edited in another checkout while Claude's folder stays in the
session's own gets the import check but not the gate. The formatter runs the Prettier and ESLint
installed in the edited file's checkout, so a worktree with no `node_modules` of its own is not
formatted.

The docs check lists what loads in a session started at the repo root under Claude Code's
default **Project instructions** setting. A session started in a subfolder, or a setting changed
in `/config`, loads another set; the load log shows what did load.

The commit gate reads a command the way a shell splits it, so it finds `git commit` after
`&&`, `;` or a pipe, with `-C` or other git options in front, and not in quoted text, a comment,
a heredoc body or `git commit-tree`. A commit inside `bash -c "…"`, a `$(…)` or a git alias is not
seen, and a commit into another repo is left to that repo's own sessions. It runs only the
stages the config names, never `package.json`'s scripts as a fallback, and has no `fix` mode.
A gate whose stages take more than 570 s in all fails every commit on time; keep the slow suites
for CI. A stage that leaves a background process holding its output keeps the gate waiting for
it.
The zsh guard matches the command's text, so a command that only quotes `${(P)…}`, in a commit
message say, is blocked too: write the message to a file and use `git commit -F`.

Four parts of the kit are for JavaScript and TypeScript: the typecheck gate fires on TypeScript
changes, the formatter runs Prettier and ESLint, the import check reads TypeScript imports, and
the manifest guard's defaults are npm's files (list others in `protect.manifests`).

What it blocks by mistake: prose that names `touch .env` or `cp … .env` in a one-line commit
message or a heredoc body (use `git commit -F` or `--body-file` instead); `ls -o <key>` and
`ls -lo <key>`, whose `-o` reads as an output flag; and `grep -o '<secret-like pattern>'`.
`.envrc` is blocked, since `.env*` covers it.

## Windows notes

- The hooks run as `node <script>` with no shell, so paths with spaces need no quoting, and Git
  Bash is not required. CI runs the tests on `windows-latest`.
- The secrets guard reads the PowerShell tool's commands as well as Bash's, including the
  aliases (`sc`, `ac`, `ni`, `copy`, `move`, `ren`) and `[IO.File]::WriteAllText`.
- The trust command setup prints carries the script's full path in quotes. Run it in PowerShell
  or Git Bash, or with `!` in the session.
- A launcher's command is a `.cmd` file in `%USERPROFILE%\.local\bin`; add that folder to your
  PATH. When a session wraps up, the launcher ends Claude Code's whole process tree with
  `taskkill`, since Claude runs inside the shell that opens its `.cmd` shim.
- When the typecheck gate hits its `timeoutSec`, it stops waiting and the turn ends, but on
  Windows the command it started keeps running until it finishes on its own.
- The plugin's files are LF (`.gitattributes` pins it). A kit-owned rule's stamp hashes the file
  with line endings normalized, so a CRLF checkout of your repo still reads as untouched.
- `/odyssey:index-it`, and `/odyssey:remember-session`'s size check, need a `python3` command on
  the PATH.
- Peek's folder is added to `CLAUDE_CODE_PLUGIN_DIRS` with `;` between folders, the separator
  Claude Code reads that list with on Windows. A `.env` saved in peek's editor is swapped in by
  PowerShell's `File.Replace`, which keeps the file's permissions.
- The status bar's command names its script by the full path, with forward slashes and in
  quotes, as Claude Code's docs advise: on Windows, Claude Code runs a status line through Git
  Bash when it's installed, and through PowerShell otherwise.
- On a Mac, Claude Code marks each message with
  ⏺ (U+23FA). Windows Terminal's default font, Cascadia Mono, doesn't have that character, nor
  does Cascadia Code, so seen from Windows Terminal (over SSH, say) it is drawn by the color
  emoji font: a blue tile with a white circle. A font that has it shows a plain mark, such as
  [JuliaMono](https://github.com/cormullion/juliamono) (free, SIL Open Font License; pick it in
  Windows Terminal under Settings, your profile, Appearance, Font face). The catch: such a font
  also has its own plain ♾, so the status bar's logo loses its emoji color. Neither choice is
  wrong; the tiles are only marks.

## Why we recommend ponytail

The kit pushes toward the smallest change inside a declared scope: a planned change names its
files before the first edit, any other file waits for your yes, and a review round with fewer
findings closes sooner. [Ponytail](https://github.com/DietrichGebert/ponytail) applies the same pressure
while the code is being written: the standard library before a dependency, a native feature
before a library, one line before fifty, and a question of whether the change needs to exist at
all. Together they close the loop: the kit limits where Claude may write, and ponytail limits
how much. The kit never bundles it or declares it as a dependency, because it is a
separate project under its own license; `/odyssey:setup` offers its two install commands, and
you decide.

## What's in it

```
oncewright/
  .claude-plugin/     plugin.json and marketplace.json
  skills/             26 skills; each procedure sits beside the SKILL.md that reads it:
                      cr-triage (+ coderabbit_feedback_vetting.md)
                      local-gate (+ gate.md: the stages, the docs stage, the verdict)
                      grill-me, name-it (+ formats.md: the glossary and ADR formats)
                      prove-it (+ tests.md), shape-it (+ deepening.md),
                      untangle (+ html-report.md), review-me, heal-me
                      mage (+ template.sh, the script's library), try-it,
                      look-it-up, today-junior, write-for-claude (+ skills.md)
                      audit, db-migration, handoff, remember-session,
                      index-it (+ scripts/survey.py and its test),
                      create-directive, setup, make-a-path, what-next, which-one,
                      wrap-up, write-for-me
  hooks/              hooks.json; session-start, load-log, protect-env, protect-managed,
                      protect-manifest, protect-append-only, bash-guard, post-edit,
                      typecheck-gate, wrap-up-stop;
                      their tests
  lib/                shared by the hooks and the script: config resolution, trust, the docs
                      check, the handoff slot, what `next` and `open` read, the stamp
  scripts/            odyssey.mjs: config | plan | apply | status | doctor | trust |
                      docs check | bar | tips | mod | launcher | next | open;
                      statusline.mjs, the status bar setup copies into ~/.claude;
                      launch.mjs, the launcher setup copies there;
                      their tests
  mods/peek/          peek, the experimental file viewer setup offers, and its tests
  mods/wrap-up/       the wrap-up band setup offers, and its tests
  scaffold/           what setup copies: the kit-owned rule and the handoff file
  schema/             odyssey.v1.json
  themes/             odyssey.json, the optional Odyssey theme
  .github/workflows/  ci.yml: node --test on three operating systems, its count checked
                      against the tests the files define; peek's tests on the same three;
                      plugin validate; survey.py compiled and its size limits tested
  README.md  SECURITY.md  CHANGELOG.md  LICENSE  .gitattributes
```

`/odyssey:setup`, `/odyssey:audit`, `/odyssey:local-gate`, `/odyssey:db-migration`,
`/odyssey:name-it`, `/odyssey:review-me`, `/odyssey:shape-it`, `/odyssey:untangle`,
`/odyssey:try-it`, `/odyssey:look-it-up`, `/odyssey:today-junior`, `/odyssey:write-for-claude`,
`/odyssey:make-a-path`, `/odyssey:what-next`, `/odyssey:wrap-up`, `/odyssey:write-for-me` and `/odyssey:mage` run only when you invoke them; Claude can't start them on its own.

## Conventions the skills assume

The plugin's skills find their inputs at these fixed paths:

| Path | Holds | In git? |
|---|---|---|
| `.claude/odyssey.json` | The config | Yes |
| `.claude/rules/odyssey/` | The kit-owned rule | Yes |
| `.claude/rules/{sensitive-data,hot-path}.md` | The project rules, each when your answers name something for it | Yes |
| `directives/handoff/current.md` | The next session's opening message | No — setup writes it empty and ignores it |
| `directives/handoff/previous.md` | The last message `/odyssey:handoff` read, kept as a record | No — setup ignores it |
| `directives/handoff/timers.md` | Optional: one-shot timers `/odyssey:handoff` arms again in the next session | No — setup ignores it |
| `references/CR reviews/` | CodeRabbit findings files and their `.resolved` dispositions | No — setup ignores it |
| `docs/plans/` | Implementation plans, each with a status header | Yes |
| `docs/grills/` | A grilling's record when no plan was named | Yes |
| `docs/untangle/` | An architecture review's report, as Markdown and as an HTML page | Your choice |
| `docs/research/` | Research notes, each finding with its source | Yes |
| `.mage/` | A mage script's record of finished stages, never a value | Your choice |
| `docs/adr/` | Architecture decision records | Yes |

They also read `CLAUDE.md`, `CONTEXT.md` and `GLOSSARY.md` when those exist — write your own.

## Companion skills

These third-party skill packs fit the same workflow. The kit links them instead of copying
them, so you get upstream updates and each keeps its own license. Matt Pocock's skills are the
exception: the ones that fit are rebuilt inside the kit (see [Credits](#credits)), so you don't
need his pack beside it.

| Pack | Author | License | Adds | Install (Claude Code) |
|---|---|---|---|---|
| [superpowers](https://github.com/obra/superpowers) | Jesse Vincent | MIT | brainstorming, systematic debugging, red/green TDD, subagent-driven development | `/plugin install superpowers@claude-plugins-official` |
| [ponytail](https://github.com/DietrichGebert/ponytail) | DietrichGebert | MIT | steers Claude to the smallest change that works — stdlib and native features first | `/plugin marketplace add DietrichGebert/ponytail`, then `/plugin install ponytail@ponytail` |

## What was deliberately left out

- **`settings.local.json`** — machine-local permission allowlists. They accumulate absolute
  paths, hostnames, scratch dirs, and occasionally a pasted API key. Let each machine grow
  its own.
- **`.mcp.json`** — not shipped; no skill needs an MCP server. If you add one, reference
  secrets as `${ENV_VAR}` only.
- **Reviewer agents** — the originals were specific to one project. The kit ships none:
  `/odyssey:review-me` checks a change against your repo's own rules, and the specifics go in
  your project rules.
- **`CLAUDE.md` / `CONTEXT.md` / `GLOSSARY.md` / `.coderabbit.yaml`** — these are ~100% project
  description. The kit reads them; write your own.
- **Third-party skill packs** — linked under Companion skills rather than copied, so each
  keeps its upstream updates and its own license. Matt Pocock's skills are the exception, rebuilt
  in the kit under its own names, with his license (see Credits).
- **Personal automation skills** — skills that drive one person's own accounts don't belong
  in a shared kit.

## Security

See [SECURITY.md](SECURITY.md) for how to report a vulnerability privately. There is no email
address to write to: reports go through GitHub's private vulnerability reporting.

## Credits

**Foundation — credit to Nick Saraev.** The 3-layer model (Directive → Orchestration →
Execution) and the self-annealing loop come from Nick Saraev's DOE ("agentic workflows")
framework. In this kit they live in [Who does what](#who-does-what) and in the
`/odyssey:create-directive` and `/odyssey:heal-me` skills.

**Original to this kit — built on top of that foundation:**

- **The CodeRabbit review loop:** triage, then a fix, round after round; finding dispositions
  (accept / defer / reject, each recorded in the `.resolved` file and answered on its thread);
  and the standing approval for commits and pushes on an open PR.
- **The skills:** `/odyssey:cr-triage`, `/odyssey:local-gate`, `/odyssey:db-migration`,
  `/odyssey:remember-session`, `/odyssey:index-it`, `/odyssey:handoff`, `/odyssey:audit` and
  `/odyssey:setup`.
- **The rules added to the model:** the docs check, git approval, scope containment,
  CodeRabbit vetting, and the kit's form of the self-annealing loop.
- **The operating rule in `primary.md`:** scope, deciding instead of asking, git, and how a
  reply ends.
- **The hooks and `/odyssey:setup`** with its config, project rules and trust model.
- **The status bar, the helper-agent rows, the spinner tips and the Odyssey theme.**

### Built from Matt Pocock's skills

Some of the kit's skills are rebuilt from [Matt Pocock's skills](https://github.com/mattpocock/skills)
(v1.3.1, commit `24fe0ef`, MIT), so you don't need to install his pack beside the kit. Each one
names its source in its first lines. For each, here is what the kit kept, added, removed and
changed, and why.

**`/odyssey:grill-me`**, from his `grilling`, `grill-with-docs`, `to-questionnaire` and `to-spec`:

| | What | Why |
|---|---|---|
| Included | The design tree and its frontier; a recommended answer with each question; facts looked up, never asked of you; done only when the frontier is empty and you agree | The core of his skill, kept as it works |
| Added | Each answer written to the plan's `## Grilling record` before the next question, and a resume from that record; a minimal plan in `docs/grills/` when none is named; open lines that name who to ask; a closing `Grilling done` line | His grilling keeps the answers only in the conversation, so a session that ends loses them; the kit keeps its records on disk |
| Removed | Asking the whole frontier in each round; to-spec's issue-tracker publishing and user stories; to-questionnaire's separate document | One question at a time lets each answer reshape the next; the kit has no issue tracker; an open line in the record carries the question to whoever can answer it |
| Evolved | Four skills folded into one; the glossary and ADR pass runs whenever the repo has a glossary or ADRs | One command for one job |

**`/odyssey:name-it`**, from his `domain-modeling`:

| | What | Why |
|---|---|---|
| Included | Challenging terms against the glossary, sharpening fuzzy words, testing with scenarios, checking the code, writing each term as it settles, the three tests for an ADR, the glossary and ADR formats | The core of his skill, kept as it works |
| Added | How the gate's docs stage uses the glossary and the ADRs; a design rejected in a grilling becomes an ADR when it passes the three tests | Ties the files into the kit's record |
| Removed | Nothing of substance; his two format files are one | Fewer files to read |
| Evolved | A new name, and it runs only when you type it or `/odyssey:grill-me` reads it | The name says what it does; a skill Claude can't start on its own stays out of the skill list every session carries |

**`/odyssey:prove-it`**, from his `tdd`:

| | What | Why |
|---|---|---|
| Included | Red before green; one vertical slice at a time; tests at agreed seams, through the public interface; his guides to good tests and to mocking | The core of his skill, kept as it works |
| Added | A second use, settling a claim with a Confirmed, Denied or Can't tell verdict and the command that shows it; seams settled before an agent takes the work, with the test files among the files it may change; both runs of each slice quoted in the report | "Is this true?" gets a check that could have failed, not a reading of the code; an agent can't stop to ask about seams |
| Removed | Sending refactors to his code-review skill | A refactor noticed mid-loop goes on a list for you, not into the diff |
| Evolved | A new name; his two guides are one file | The name says what it does; fewer files to read |

**`/odyssey:heal-me`**, from his `diagnosing-bugs` and the kit's `self-anneal`:

| | What | Why |
|---|---|---|
| Included | Redacting secrets; a check that fails on the bug before any hypothesis; reproduce, then shrink; three to five falsifiable hypotheses shown to you; tagged debug lines; a regression test at a seam that meets the bug, or a note that none exists; the right hypothesis in the commit | The core of his skill, kept as it works |
| Added | The self-annealing loop's last step, the lesson written where the next session reads it (a directive, an ADR, the project rules, the plan); the debug lines' removal checked with `git grep`; the fix recorded like any direct change; from his `retro`, a check proposed before a written rule when a check could have caught the mistake | A fix that teaches nothing repeats; a search catches a debug line the eye misses; a check keeps catching what prose only asks for |
| Removed | His script template for steps a person must do; a shorter list of ways to build the check | A step only you can do comes as numbered commands to paste back |
| Evolved | Merged into the kit's `self-anneal` and renamed; the fix is made directly in the session | One skill for when something breaks, routed the way planned work is |

**`/odyssey:review-me`**, from his `code-review`:

| | What | Why |
|---|---|---|
| Included | Two axes, standards and spec, in parallel subagents and never merged; the code-smell baseline, each smell a judgment call the repo's rules override | The core of his skill, kept as it works |
| Added | The fixed point defaults to the slice's starting commit; uncommitted work counts; the ADRs count as standards | You rarely have to name a ref |
| Removed | The issue tracker as the spec's source; what tooling, the gate or CodeRabbit already checks | The spec is the plan; a second pass over what runs anyway is noise |
| Evolved | A new name; it runs only when you type it | Reviewing is your call, and it starts two subagents |

**`/odyssey:shape-it`**, from his `codebase-design`:

| | What | Why |
|---|---|---|
| Included | The words (module, interface, depth, seam, adapter, leverage, locality), the principles, the dependency categories, and designing an interface several ways in parallel | The core of his skill, kept as it works |
| Added | A design you turned down goes into the plan's decisions with its reason | So it isn't proposed again without that reason |
| Removed | Nothing of substance; his two extra guides are one file | Fewer files to read |
| Evolved | A new name; it runs when you type it or another kit skill reads it | The name says what it does |

**`/odyssey:untangle`**, from his `improve-codebase-architecture`:

| | What | Why |
|---|---|---|
| Included | Scoping to hot spots first; a subagent walk for friction; the deletion test; ranked candidates with before-and-after diagrams; the HTML page with Tailwind and Mermaid; an ADR raised only when worth reopening; no interfaces until you pick one | The core of his skill, kept as it works |
| Added | Hot spots also from the plans' deferred items; a Markdown record saved in `docs/untangle/` beside the page; a chosen candidate becomes a plan, then a grilling | The kit's records show where work keeps landing; the Markdown copy reads in a terminal and in git |
| Removed | Opening the page for you, and writing it to a temporary folder | Over SSH there is no browser to open; both paths are printed instead, and the files stay |
| Evolved | A new name; it runs only when you type it | The name says what it does |

**`/odyssey:try-it`**, from his `prototype`:

| | What | Why |
|---|---|---|
| Included | One question per prototype; a single HTML page driving a pure logic module by buttons and guided scenarios; three to five structurally different UI variants behind `?variant=` with a floating switcher; state in memory, no polish | The core of his skill, kept as it works |
| Added | The verdict written as a G-line in the plan's grilling record; the prototype's files counted as the request's scope, since they never reach the main branch | The answer lands where the plan's decisions live |
| Removed | Pointers to an issue on a tracker; opening the page for you | The plan holds the record; over SSH there is no browser |
| Evolved | It lives on a local `prototype/<name>` branch that is never pushed, or in the scratchpad; a new name; it runs only when you type it | Throwaway code never reaches the main branch or the remote |

**`/odyssey:look-it-up`**, from his `research`:

| | What | Why |
|---|---|---|
| Included | A background subagent reading primary sources, each claim followed to the source that owns it | The core of his skill, kept as it works |
| Added | A fixed home, `docs/research/<date>-<slug>.md`, with a source on every finding and an `Unverified` section; the plan cites the file | You can tell what was checked from what was only found |
| Removed | Choosing where to save it each time | One place to look |
| Evolved | A new name; it runs only when you type it | The name says what it does |

**`/odyssey:today-junior`**, from his `wait-what`:

| | What | Why |
|---|---|---|
| Included | Re-pitching the last message with context first, in Simplified Technical English, in the glossary's words | The core of his skill, kept as it works |
| Added | Each kit term spelled out once with the file on disk it refers to; what happens next | Kit words like "slice" or "G-line" only help when you can open the file |
| Removed | Nothing | It was already short |
| Evolved | A new name | The name says when to type it |

**`/odyssey:write-for-claude`**, from his `writing-for-agents`:

| | What | Why |
|---|---|---|
| Included | Pointers, the two loads, the ladder of steps and reference, completion criteria, when to split, leading words, stating the target instead of the ban, pruning, and the choice between model-invoked and typed skills | The core of his skill, kept as it works |
| Added | The kit's rule that a skill other skills only read by path stays typed; the YAML trap in descriptions; `/odyssey:audit` cites these rules in its findings | One rule for every skill in the kit, checked in every audit |
| Removed | Advice about instruction files for other tools | The kit writes for Claude Code |
| Evolved | A new name; it runs when you type it or the audit reads it | The name says what it does |

**`/odyssey:mage`**, from his `wizard`:

| | What | Why |
|---|---|---|
| Included | A bash script that walks a person through steps only they can do: stages with progress, links, visible and silent questions, `.env` writes, GitHub secrets, a closing summary; scoping from the repo first; never inventing a step | The core of his skill, kept as it works |
| Added | A record on disk of each stage (never a value), so a rerun skips finished stages; a check command per stage instead of "press Enter"; numbered steps, one command per block, naming the machine; a test of the template | A rerun shouldn't repeat finished work, and "done" should be proved; the record tells Claude what actually happened |
| Removed | Opening a browser when there is no display or the session is over SSH | The link is printed instead |
| Evolved | A stage that fails its check, and that you give up on, stops the run; a new name | Later stages build on earlier ones |

**Folded into the kit's own skills:** his `pr` gave `/odyssey:cr-triage` its one-way or two-way
door and blast-radius line; `retro` gave `/odyssey:heal-me` its check-before-prose rule;
`handoff` gave `/odyssey:handoff` the command to start with and the redaction rule.

**Not taken:** `triage` and `wayfinder` (they need an issue-tracker setup and labels, and "triage"
beside `/odyssey:cr-triage` would confuse), `teach` (it builds a workspace in the current folder),
`implement`, `implement-spec` and `to-tickets` (the kit makes a plan's slices directly, one at a
time), and his setup skill and `grill-me`
(they only make sense inside his pack).

His license:

```
MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**`/odyssey:which-one`**, from his `ask-matt`:

| | What | Why |
|---|---|---|
| Included | A map from what you want to do to the skill that does it, with one answer given and the chains that link skills | The core of his router |
| Added | A "Not when" for each row; a test that the map names every kit skill; `odyssey.mjs next` deciding when the answer depends on where the repo stands; Claude can start it on its own | The map can't fall behind the kit, and Claude can point you to the skills it can't start itself |
| Removed | His flow essay, the issue tracker on-ramps, the precondition skill and the five-way guide to what to do at a phase boundary | A table scans faster than about 2,600 words; the kit has no issue tracker; `/odyssey:make-a-path` says where the next step runs |
| Evolved | A new name; the call at a phase boundary moved to `/odyssey:make-a-path`, which never makes compacting the default | Compacting summarizes away what the next step needs |

### Thanks to pstack

**Thanks to pstack** (Lauren Tan, MIT) for the idea of triage settling a claim with one cheap
test run. The kit's text for it is its own, and no pstack file is included. Her license:

```
MIT License

Copyright (c) 2026 Lauren Tan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**Companion skills** (above) are separate projects, linked rather than included, and
belong to their authors.

## License

MIT — see [LICENSE](LICENSE). The copyright covers the original work listed under Credits;
the DOE framework is credited to Nick Saraev, the skills built from Matt Pocock's carry his
MIT notice above, and the companion skills are separate projects under their own licenses.
