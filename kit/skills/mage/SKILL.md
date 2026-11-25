---
name: mage
description: Writes a bash script that walks a person through steps only they can do (dashboards, credentials, CI secrets), checking each and resuming where it stopped. Use when setup needs a person's hands.
disable-model-invocation: true
---

# Mage

Built from Matt Pocock's `wizard` (mattpocock/skills v1.3.1, MIT); see Credits in the kit's README
for what changed and why.

A **mage** is a bash script that walks a person, one stage at a time, through steps only they
can take, and checks each one before moving on. `template.sh` beside this file is its library:
stages with progress, numbered steps, links, visible and silent questions, `.env` writes, GitHub
secrets, a check per stage, and a record on disk. Your job is to scope the procedure and write its
stages; the library above the `STAGES` line stays as it is in every mage.

It runs in bash on macOS and Linux, and on Windows through Git Bash or WSL.

## 1. Scope it

Read the repo before asking anything: `.env.example` and other `.env.*` templates, the README,
`docker-compose*`, the framework's config, and `.github/workflows/*` (each `secrets.*` and
`vars.*` there is a value the mage must produce). For a migration or a cutover, the current
state, the target state, and the steps between them that can't be undone.

Show the user the stages in order and the values each produces; they may add, drop or reorder.
**Done when** for every value you know where the person finds it, where it's written (`.env`, a
GitHub secret, both, or nowhere), and whether it's secret.

## 2. Map each stage

For each stage, the exact path a stranger could follow: the URL, what to click, where the value
appears ("Dashboard → Developers → API keys → Reveal test key → copy"). Where you don't know the
current page or command, check its documentation or ask: a step that may not exist is never
written down as if it does.

## 3. Write it

Copy `template.sh` to `scripts/mage/<name>.sh` when the setup will be repeated, or to the
scratchpad for one run. Set `MAGE_NAME` and `TOTAL`, and replace the example stage with one
`stage` per step, in order. Each stage is two functions:

- **the steps**: `do_this` for an action, `run_this "<machine>" "<command>"` for a command (one
  per block, numbered, naming the machine it runs on), `link` for a page, `ask` or `ask_secret`
  for a value, then `save_env` and `gh_secret` for where it goes, and `confirm` before anything
  that can't be undone;
- **the check**: a command that passes only if the stage worked (`gh secret list | grep -q NAME`,
  a `curl` that needs the new key, `test -s <file>`, a CLI's login status). Reach for "the person
  says it's done" only when nothing can check it, and say so in the stage.

Every secret comes in through `ask_secret`, which reads without echo; the script never prints a
secret value, and the record never holds one. `link` opens a browser only when the machine has a
display and isn't an SSH session, and prints the URL either way.

## 4. Check it and hand it over

- `bash -n <script>`, and `shellcheck <script>` when it's installed; `chmod +x <script>`.
- Don't run it yourself: it waits for a person. Trace it instead: every value from step 1 is
  asked for and lands where step 1 said, and every `gh_secret` name matches a `secrets.*`
  reference in the workflows.
- Give the user the command to run it: numbered, one command per block, naming the machine.

The record, `.mage/<MAGE_NAME>.record`, holds one line per stage: its id, `done` or `left`, the
time, and a note, never a value. Read it after the run to pick up from what actually happened; a
rerun skips each finished stage whose check still passes. Keep `.mage/` out of git unless the team
wants the record shared.
