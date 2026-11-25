---
name: wrap-up
description: "Closes a session in one command: stops its jobs, waits for its agents, saves memory, tidies the index when it is past its target, and writes the handoff. Use when a session is done or its context is filling up."
disable-model-invocation: true
---

# Wrap up

One command for the end of a session, in this order. Typing it approves every step, so run
straight through without asking; in a session the kit's launcher started, the Stop hook's request
to run it counts as typing it. The one stop is in step 3.

1. **Jobs and agents.** If this session scheduled jobs, or started a Monitor, a background task
   or an agent, read `references/stop-and-wait.md` beside this file and follow it first.
   Otherwise skip this and load nothing for it.
2. **Read, in one Bash call:** `../handoff/references/write.md` (from this skill's folder), the
   memory directory's `MEMORY.md` (the store named in your system prompt) and the memory files
   that own what this session changed, `directives/handoff/current.md`, and
   `git status --short --branch`. With more than about 10 memory files, add
   `../remember-session/SKILL.md` and follow its §3 when you write.
3. **Write, in one Bash call** (heredocs). If `current.md` holds another session's message, show
   it and ask instead; do not quit.
   - **Memory:** only what outlives the next session: rulings and corrections, with the user's
     words and the why; facts the repo can't record (consoles, vendor behavior, values); claims
     this session proved wrong, marked superseded where they stand, never deleted. Update the
     file that owns a topic rather than adding a sibling, and give each touched file one
     hook-first line in `MEMORY.md`. The branch, commits and next step go in the handoff, not in
     memory.
   - **The handoff,** per `write.md` (read in step 2; do not load it again).
   - **Last,** `wc -c -l` of `MEMORY.md`, then
     `[ -n "$ODYSSEY_LAUNCH" ] && touch "$ODYSSEY_LAUNCH.quit" && echo launched || echo "not launched"`.
4. **The index.** Only when `MEMORY.md` is past its target (16 KB or 150 lines), read
   `../index-it/SKILL.md` (from this skill's folder) and run its `apply` job without asking (it
   never deletes). Otherwise skip it and load nothing for it. On a store's first index, index-it
   shows its proposal and stops; add the line "The memory index is past its target: run
   `/odyssey:index-it apply`." to the handoff's open flags, where the next session and
   `/odyssey:what-next` find it.
5. **Report** in a few lines: what stopped, the agents that reported or checkpointed, the memory
   files touched, whether the index was tidied or under its target, and the handoff's first
   line. `launched`: the kit's launcher ends this session about 10 seconds after the turn
   (once its agents and tasks finish) and starts the next with `/odyssey:handoff`.
   `not launched`: the report's last line is: Quit (`/exit`), then run this repo's launcher
   (`/odyssey:setup status` names it; setup makes one), or `claude "/odyssey:handoff"` from the
   repo root.

The wrap-up mod's band runs this skill, and the status bar's hint names it.
