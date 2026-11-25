# Writing the handoff

1. Read `directives/handoff/current.md` first. If it holds a message from another session, stop,
   show it, and ask whether to overwrite. Never silently clobber.
2. Before writing a line, ask whether you can do it now: if it needs no approval you don't have
   and this session may do it (a compacted session only writes this message), do it, and write
   down the result instead.
3. Write the next session's opening message. It carries what the next session can't work out for
   itself: the decisions the user still owes, the state, and the traps; never a chore. Plain
   Markdown, in this order, aim for 15–30 lines:
   - **Read first:** memory file names (kebab slugs) and what in each matters now.
   - **State:** branch, what is uncommitted, standing rules that bind the next session (e.g.
     "commit deferred, do not ask").
   - **First:** the immediate task, naming the exact files and line ranges it reads and changes,
     so the next session opens them without searching; the ruled lines to replay, the facts to
     verify, and the `/odyssey:` command to start with when one fits.
   - **Later:** the queue after that, in order.
   - **Open flags:** anything the user has not decided that the next session must surface.

   Redact as you write: no secret value, token or password and no personal data (an email
   address, a phone number) goes into the message; name where each one lives instead.
4. The handoff carries pointers and memory carries facts: run `/odyssey:remember-session` in the
   same turn if the user asked for it (`/odyssey:wrap-up` does both).

Both files stay untracked: the slot is a relay and `previous.md` its last message, not repo
artifacts.
