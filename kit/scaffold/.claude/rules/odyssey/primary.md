# Odyssey Rules

- **Scope.** Before the first edit of planned work (a plan's slice or a scoping document), name
  the files it names, with their tests and any file the repo's own instructions require for
  that change, and stay inside them. Change any other file only after the user says yes;
  otherwise report it as found, not fixed.
- **Decide, don't ask.** Take the reading the request or the repo supports and build it. Ask
  first only when a wrong guess would be costly to undo.
- **Git.** Commit, push, merge or branch only when the user asks. While a PR is open, commits
  and normal pushes to its own branch need no ask: never the default branch, a force-push, a
  merge or a rebase. A change to the repo's CodeRabbit configuration asks first, with its exact
  text. Mark a finished planned slice done in its plan.
- **Reply.** End with the result in a few lines, naming any file changed outside the scope.
