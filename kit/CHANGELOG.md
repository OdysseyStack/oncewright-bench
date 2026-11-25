# Changelog

All notable changes to this plugin are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Every entry names the hooks that
changed, because a changed hook changes what a session may do.

## [1.0.0] - 2026-11-18

The first release: the kit as a Claude Code plugin, installed from the `odyssey-ai` marketplace
and fitted to each repo by `/odyssey:setup`.

### Added

- **How work gets made** (`primary.md`, the kit's one always-on rule, under 1 KB: scope,
  deciding instead of asking, git, and how a reply ends): before the first edit of planned work,
  Claude names the files the plan's slice names, with their tests and any file the repo's own
  instructions require for that change (a doc or changelog its CLAUDE.md asks for), and stays
  inside them; any
  other file only after you say yes, and otherwise it is reported as found. An open choice is
  decided, not asked about, unless a wrong guess would be costly to undo. Git waits for you,
  except that while a PR is open, commits to its own branch and normal pushes need no further
  approval; that never covers the default branch, a force-push, a merge or a rebase. A finished
  slice is marked done in its plan, and the reply ends with the result in a few lines, naming
  any file changed outside the scope. What a script can check runs as a hook instead, at no
  cost to Claude's context until it fires: the commit gate and the zsh guard, below.
- **Skills (26):**
  - Review and checks: `/odyssey:cr-triage`, `/odyssey:review-me`, `/odyssey:local-gate` and
    `/odyssey:db-migration`.
  - Planning and design: `/odyssey:grill-me`, `/odyssey:name-it`, `/odyssey:shape-it`,
    `/odyssey:untangle`, `/odyssey:try-it` and `/odyssey:look-it-up`.
  - Building and fixing: `/odyssey:prove-it`, `/odyssey:heal-me` and `/odyssey:mage`.
  - Sessions and memory: `/odyssey:handoff`, `/odyssey:remember-session`, `/odyssey:index-it`,
    `/odyssey:wrap-up`, `/odyssey:make-a-path` and `/odyssey:what-next`.
  - The kit and its docs: `/odyssey:setup`, `/odyssey:audit`, `/odyssey:create-directive`,
    `/odyssey:which-one`, `/odyssey:today-junior`, `/odyssey:write-for-claude` and
    `/odyssey:write-for-me`.

  Claude can start six of them on its own; the other twenty run only when you type them, or
  when another skill reads one by path.
- **The review loop:** a round is triage, then one fixer. `/odyssey:cr-triage` vets each
  CodeRabbit finding into a recorded verdict in a `.resolved` file, adds one line to the PR
  description (a one-way or two-way door, and the blast radius), and, once a round is done, answers each inline finding's thread with its verdict in one line,
  resolving the thread when the finding was accepted or rejected, but not when it was deferred.
  A rejected finding is answered there and recorded in the `.resolved`, never in the code.
  CodeRabbit can save a reply as a learning, so triage names any it saved under a rejection or
  a deferral. The fixer (the same session, a fresh one given the `.resolved`, or one
  agent in an automated chain) makes the accepted fixes directly, commits, which runs the gate,
  and pushes to the PR's branch; the next round starts with triage again.
- **Skills rebuilt from Matt Pocock's library**, each with what the kit kept, added, removed and
  changed, and why, in the README:
  - **`/odyssey:grill-me`**, from his `grilling`, `grill-with-docs`, `to-questionnaire` and
    `to-spec`: one question at a time, each answer written to the plan's `## Grilling record`, or
    to `docs/grills/` when no plan is named, before the next question, and picked up from that
    record in a later session. A question only someone else can answer is written down as open,
    naming who to ask.
  - **`/odyssey:name-it`**, from his `domain-modeling`: resolves terms into `GLOSSARY.md` as they
    settle and records decisions that are hard to reverse as ADRs in `docs/adr/`.
  - **`/odyssey:prove-it`**, from his `tdd`: red before green, one vertical slice at a time, at
    seams agreed with you; and, asked whether something is true, a check that could fail and a
    Confirmed, Denied or Can't tell verdict with the command and its output.
  - **`/odyssey:heal-me`**, with his `diagnosing-bugs` merged in: before guessing at causes it
    builds one command that fails on the bug, shrinks the case, ranks falsifiable hypotheses,
    tags its debug lines, and makes the fix directly with a regression test, recording the lesson
    where the next session reads it. It proposes a check (a test, a lint rule, a hook, a gate
    stage) before a written rule when a check could have caught the mistake.
  - **`/odyssey:review-me`**, from his `code-review`: two parallel reviews of the changes since a
    fixed point, one against the repo's written standards and a code-smell baseline, one against
    the plan, reported side by side.
  - **`/odyssey:shape-it`**, from his `codebase-design`: the words and method for deep modules
    and seams, and designing an interface several ways in parallel.
  - **`/odyssey:untangle`**, from his `improve-codebase-architecture`: finds hot spots (from git
    history and the plans' deferred items), ranks deepening candidates, saves them in
    `docs/untangle/` as Markdown and as an HTML page (Tailwind and Mermaid from their CDNs), and
    takes the one you pick into a plan and a grilling.
  - **`/odyssey:try-it`**, from his `prototype`: a throwaway prototype that answers one design
    question, a single HTML page that drives a logic model or several UI variants to flip
    between, on a local branch that is never pushed; its verdict goes into the plan's grilling
    record.
  - **`/odyssey:look-it-up`**, from his `research`: a background subagent reads primary sources
    and saves the findings, each with its source, to `docs/research/`, with an `Unverified`
    section.
  - **`/odyssey:today-junior`**, from his `wait-what`: re-explains the last message in plain
    words, each kit term with the file it refers to.
  - **`/odyssey:write-for-claude`**, from his `writing-for-agents`: how to write skills, rules and
    `CLAUDE.md` so Claude takes the same path every run, and the kit's rule for which skills
    Claude can start on its own.
  - **`/odyssey:mage`**, from his `wizard`: writes a bash script that walks a person through steps
    only they can do, proves each stage with a check, keeps secrets off the screen, and records
    finished stages so a rerun picks up where it stopped.
  - **`/odyssey:which-one`**, from his `ask-matt`: says which skill or chain fits what you want to
    do, and when not to use it; the front door to the skills Claude can't start itself.
- **`/odyssey:write-for-me`**: writes as you. A short setup asks what the writing is for (a bio,
  posts, an article, docs, email), whose voice it is and how long the quiz runs. The quiz asks
  what you do in real situations, such as a 2am outage, a price objection or a joke at your
  expense, since that shows a voice better than asking how you write. Each round is saved as it
  ends, in a voice profile in Claude's memory; the readout gives five traits with the answers
  behind them, and each piece comes back as a few options, each with a reason, and a pick.
- **Finding your place:** `/odyssey:make-a-path`, with `scripts/odyssey.mjs next`, says where you
  are with the work in front of you and the one command that moves it on, read from the handoff
  slot, the branch, CodeRabbit findings files and the plans by fixed rules, first
  match wins; the skill adds the open pull request through `gh`. `/odyssey:what-next`, with
  `scripts/odyssey.mjs open`, lists every open thread in the repo with the file it came from, and
  three to pick up, work that can be lost ranked first.
- **Between sessions:** `/odyssey:handoff write` leaves the next session's opening message,
  naming the `/odyssey:` command it starts with and keeping secrets and personal data out;
  `/odyssey:handoff` reads it once, keeping it in `directives/handoff/previous.md` before it
  resets the slot, and arms the one-shot timers kept in `directives/handoff/timers.md`.
  `/odyssey:wrap-up` closes a session in one short command: it stops the session's scheduled
  jobs, waits for its background agents and any task it lets finish, folding in what they report,
  saves memory and writes the handoff in one step, then
  tidies the memory index without asking when it's past its target.
- **The launcher** (`scripts/launch.mjs`, offered by `/odyssey:setup` under a name you choose,
  one per repo, installed with `scripts/odyssey.mjs launcher install <name>`): a command in
  `~/.local/bin` that opens the repo in Claude Code from any folder. Past the wrap-up mark the
  kit asks Claude to run `/odyssey:wrap-up`; once it has, the launcher ends that session and
  starts the next with `/odyssey:handoff`, so work carries on session after session; the first
  session opens with it only when a handoff message or a timer waits. It reads
  the context from the status bar; on Windows it ends Claude Code's whole process tree. Two
  launcher sessions in one repo keep their own flag files, so one's wrap-up never ends the other.
  After three sessions in a row that each wrapped up within 5 minutes of starting, it stops and
  says why, so a session that starts past the mark can't relaunch all night. It refuses
  claude's own flags anywhere on the line, which later sessions would start without, and names
  the settings that cover every session. After wrap-up it gives the session's other Stop hooks
  10 seconds before ending it. `launcher status` and `/odyssey:setup status` name it, and
  `launcher remove` deletes it.
- **Memory within Claude Code's load limit:** `/odyssey:remember-session` checks the memory
  index with index-it's survey (skipped when the index is plainly small), which counts its lines
  as well as its bytes (Claude Code loads the first 200 lines or 25 KB), and past 150 lines or
  16 KB runs `/odyssey:index-it` itself, which proposes a restructure for you to apply.
- **Hooks (10), in exec form:** `session-start` (tells Claude that the session was compacted or
  that a handoff message is waiting, without reading the message to it, and shows you a line
  for a waiting handoff, except after a compaction), `load-log`
  (one line for each instruction file Claude Code loads, for the docs
  check and `/odyssey:audit`), `protect-env` (the secrets guard: edits, Bash, PowerShell and
  the MCP file tools; letter case ignored; the trust file and the approve command guarded;
  fails closed),
  `protect-managed` (edits to stamped kit-owned files), `bash-guard` (before Bash and
  PowerShell: the zsh guard blocks zsh's `${(P)…}` and `${(f)…}`, which Claude Code's safety
  check refuses, and names the plain test to use; the commit gate runs the gate's stages and
  docs stage, every one to its end, before a `git commit`, `git -C <dir> commit` and a commit in
  a chain included, and blocks the commit when one fails), `protect-manifest` (hand edits to
  dependency manifests and lockfiles wait for your explicit approval),
  `protect-append-only`, `post-edit` (format with the repo's own Prettier and ESLint, the
  nearest install up to the git root, then the ESM import check;
  a file in another checkout of the same repo, such as a linked git worktree, is formatted and
  checked with that checkout's config) and `typecheck-gate`
  (the configured command at Stop, while uncommitted TypeScript changes are in the working tree
  of the checkout Claude is in, a linked git worktree included), and `wrap-up-stop` (in a session
  the launcher started: past the wrap-up mark, asks Claude to run wrap-up, never twice in a row,
  and after it, tells the launcher to start the next session once no background agent, workflow,
  teammate or shell task is running, saying what holds it; a quit flag over 15 minutes old that
  no stop held, left by an interrupted wrap-up, is dropped). The two file guards,
  `session-start` and the zsh guard are always on; the commit gate is on wherever the config
  names gate stages (`hooks.commitGate: false` turns it off); `wrap-up-stop` acts only under the
  launcher; the rest are switched on in `.claude/odyssey.json`.
- **Trust for hooks that run code:** the commit gate, `typecheck-gate` and the formatter run
  only after the user approves the exact command for the exact repo, its git worktrees included, with
  `scripts/odyssey.mjs trust approve`. No environment variable grants trust: a CI pipeline runs
  the approve command as one of its steps.
- **`/odyssey:setup`:** the interview, one filled-in proposal you confirm or change (each gate
  stage it proposes is run once first and timed; one that fails on the untouched repo is left
  out, and the slowest, one at a time, until the rest take under about 500 s; the docs check the
  gate runs after them is run too, with an offer to fix what it finds), a dry run, create-only
  writes of the kit-owned rule (stamped and hashed, upgraded on re-run), the project rules, each
  only when the answers name something for it (the sensitive-data rule with where credentials
  live and how to read one without printing it, and the hot-path rule), the config, the handoff
  file and two `.gitignore` lines (`directives/handoff/` and `references/CR reviews/`). A re-run
  also tidies what builds before this release left: it removes the config keys `reviewers` and
  `layer2Owned`, the one change it makes to an existing config, and, where they are untouched,
  their five rule files and their `directives/layer_3_work_orders/` folder (untouched when it
  holds only its placeholder); anything edited is kept and named as yours to delete. `status`
  also says whether a handoff is waiting; and `doctor`, which also fails a setting that silently
  does nothing: a typecheck gate with no command, a `srcDirs` or `testDirs` entry that is no
  folder in the repo, `formatOnEdit` without Prettier, a command a hook runs that isn't trusted
  yet (naming the approve command), a status bar script that is missing
  or differs from this kit version's, and a copy of a mod that is missing or differs. It also
  offers the status bar, the launcher, the spinner tips, peek and the wrap-up band for your
  machine, in the folder `CLAUDE_CONFIG_DIR` names when it is set, and the separate ponytail
  plugin, all in one step of multi-select questions.
- **The status bar**, offered by `/odyssey:setup`, since a plugin can't turn one on, in up to
  three rows: the `[ODYSSEY]` badge, the context bar with its wrap-up mark at 35%
  (`ODYSSEY_WRAPUP_PCT`) and `wrap up: /odyssey:wrap-up` past it, the model and effort, and the
  session's cost marked as plan or API; whether a handoff is waiting, at the end of that row or
  on one of its own; and the plan's five-hour and weekly limits with
  when each starts again, or a gateway's spend limit, gold from 80%. On a narrow terminal it
  shortens or drops parts to fit. The same script gives each helper agent's row the bar's look.
  It keeps your status line in front, and lives in your user settings and
  `~/.claude/odyssey-statusline.mjs`. It doesn't animate. `scripts/odyssey.mjs bar remove`
  takes it out and puts your status line back.
- **Spinner tips:** tips about the kit's commands and its secrets guard, offered by
  `/odyssey:setup`, beside Claude Code's own; `scripts/odyssey.mjs tips remove` takes them out.
- **The Odyssey theme**, `themes/odyssey.json`, for dark terminals: in `/theme`, and off unless
  you pick it.
- **Peek (experimental)**, `mods/peek/`, offered by `/odyssey:setup`: `/peek <path>` shows a file
  from the repo, its worktrees or a folder you approve in a pane (Markdown, code, tables, JSON,
  PDF and Word text, pictures, audio), `/peek diff` what changed; it refuses the files the
  secrets guard protects, except a `.env`, which opens in an editor with its values masked. It
  needs Claude Code 2.1.288 or newer. `scripts/odyssey.mjs mod install peek` copies it to
  `~/.claude/odyssey-peek` with a copy of the guard it reads its patterns from, and names that
  folder in `CLAUDE_CODE_PLUGIN_DIRS` in your user settings; `mod status peek` and
  `mod remove peek` check and undo it.
- **The wrap-up band** (`mods/wrap-up`, offered by `/odyssey:setup`, installed with
  `scripts/odyssey.mjs mod install wrap-up`): past the wrap-up mark, a band above the prompt
  whose **Wrap up** runs `/odyssey:wrap-up`. It queues one command, since a second queued command
  would be fed in as the answer to any question the first one asks.
- **`scripts/odyssey.mjs docs check`:** the instruction files found by walking the repo, with
  the files they import and when Claude Code loads each, beside the files it loads from outside
  the repo and the load log; then their claims, and those in `CONTEXT.md`, `GLOSSARY.md` and
  `README.md`, checked against the repo (imports, named paths, `npm run` names, ADR citations,
  personal skills shadowing the repo's); it is the gate's `docs` stage, with the repo's own docs
  check (`docs.check`) after it.
- **`/odyssey:audit`:** which instruction files load and when, which rules sit in files that
  never load, which claims the code disproves, which rules contradict each other, and which
  lines break `/odyssey:write-for-claude`'s rules; it reports and edits nothing.
- **The config**, `.claude/odyssey.json`, with its schema `schema/odyssey.v1.json`: among others, the
  gate's stages, the source and test folders, the hooks switched on, the protected files, the
  migration flow, a plan outside `docs/plans/` (`docs.plan`) and the repo's own docs check
  (`docs.check`). The keys `metaSync`, `reviewers`, `layer2Owned`, `docs.roadmap`,
  `docs.deploy`, `docs.deployManifest` and `docs.always`, from builds before this release, are
  no longer read, and a config that has them stays valid.
- **CI** on macOS, Linux and Windows, Node 22 and 24: `node --test` over every `*.test.mjs` in
  the plugin, its count checked against the tests the files define, none skipped; the two mods'
  tests with `claude plugin test` on the same three systems, every test file run and none
  failed; `claude plugin validate --strict`, for the kit and for both mods; and index-it's survey
  script compiled, with its size limits tested.
- **Docs:** the README, with credits for Matt Pocock and Lauren Tan and their MIT notices; this
  changelog; `SECURITY.md` with the threat model.
