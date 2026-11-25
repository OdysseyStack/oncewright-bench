# Stop the jobs, wait for the agents

- **Jobs.** If this session scheduled jobs, `CronList`, then `CronDelete` each one. Leave
  `directives/handoff/timers.md` alone: its entries are the durable copy, and the next session's
  `/odyssey:handoff` arms them again; a job meant to outlive this session that has no entry
  there gets one now (the handoff skill's `references/timers.md`).
- **Tasks.** Stop every Monitor and background task this session started (`TaskStop`), except
  one that is writing something that must not be cut off: let it finish and start nothing new.
  Fold its result into memory and the handoff when it ends.
- **Agents.** Background agents (the Agent tool) end when this session ends, and a relaunch pays
  again for everything they did, so for each agent still running:
  - Let it finish. Run wrap-up's steps 2 to 5 while it works; the Stop hook holds a launched
    session's relaunch until every agent and task has finished. As each report arrives, fold its
    result into memory and the handoff.
  - Only when this session can't wait (its context is near the limit, or the user says quit
    now): message each running agent (`SendMessage`) to checkpoint. It commits what's done
    locally (if the commit gate blocks it, it leaves the work uncommitted and lists the changed
    files in its handoff file), writes a handoff file of its own (what's done, what's next,
    decisions the code doesn't show), stops and replies. Wait for every reply, then name each
    handoff file under **First** in the handoff.
