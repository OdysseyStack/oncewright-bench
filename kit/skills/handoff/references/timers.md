# Timers

`CronCreate` jobs end with the session, and `/odyssey:wrap-up` deletes them before it quits. A
timer that must fire in a later session also gets an entry in `directives/handoff/timers.md`
(untracked, beside `current.md`), and the session arms it with `CronCreate` the way the step
below does. The file is not reset on read: an entry is deleted only when its timer fires (its
prompt's first line) or when the user cancels it. One entry per timer:

```
## <id> · `<cron, local time, one-shot>`
<the prompt, self-contained>
```

**Arming them** (`/odyssey:handoff`): for each entry, in time order, if its time is still ahead,
`CronCreate` it (`recurring: false`, the entry's cron, and its prompt with the line "First delete
the `## <id>` entry from `<repo root>/directives/handoff/timers.md`." put in front). If its time
has passed, it was missed while no session ran: delete the entry and run its prompt now.
