# Rules for every Claude Code session on this machine

[Published copy: the file the `cuts` runs loaded, with three sections replaced by one-line notes and
the hook's file, the handoff folder and a setting's name left out. The rest is as they loaded it.]

## Never end a session over running background agents

Background agents (Agent tool) die when the session that started them ends, and a relaunch pays again for everything they did. Before any quit, relaunch, `/exit` or `/wrap-up`:

- Wait for every running agent to finish and report. Do the rest of the wrap-up (memory, handoff) while they work, and quit only after all of them have reported. If a wrap-up Stop hook re-asks while you wait, just end the turn.
- Only when the session can't wait (its context is near the hard limit, or the user says quit now), message each running agent to checkpoint: commit what's done locally, write a handoff file (what's done, what's next, decisions not visible in the code), stop and reply. Wait for every reply before quitting, and name each handoff file in the session's handoff.
- If the user asks to quit while agents are running, say which ones are still working before doing it.

## A subagent checkpoints itself at the wrap-up mark

Ruled 2026-11-18 ("Checkpoint hook"). A hook gives every subagent the
checkpoint rule at its start (SubagentStart) and, once its own context passes the wrap-up mark, a
"Wrap-up mark:" note after a tool call. The agent then commits locally, writes
a handoff file, stops, and replies starting `CHECKPOINT <path>`.

- On a `CHECKPOINT` reply, relaunch at once without asking: same agent type, model and effort, the original
  brief plus "Resume from <path>: read it first; it overrides the brief where they differ". If the agent
  had a worktree, give the new agent that worktree's path and branch instead of a new isolated worktree.
- Delete the handoff file once the new agent has reported.

[Removed for publication: rules for an agent that drives the owner's browser, such as keeping to one tab.]

[Removed for publication: rules for which model and effort a subagent gets.]

[Removed for publication: a rule to start a CodeRabbit review triage in a background subagent after a push to a pull request, and what its brief holds.]
