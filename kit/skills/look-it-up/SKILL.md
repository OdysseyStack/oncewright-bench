---
name: look-it-up
description: Researches a question against primary sources in a background agent and saves the sourced findings to docs/research/. Use when the user wants a topic or a tool researched.
disable-model-invocation: true
---

# Look it up

Built from Matt Pocock's `research` (mattpocock/skills v1.3.1, MIT); see Credits in the kit's
README for what changed and why.

Start a **background subagent** for the reading, so the session keeps working, and give it this
job:

1. Answer the question from **primary sources**: official documentation, the source code,
   specifications, first-party APIs, release notes. Follow each claim back to the source that
   owns it; a blog post or forum answer is a lead to follow, not a source.
2. Write `docs/research/<YYYY-MM-DD>-<slug>.md`:

   ```markdown
   # <the question>

   **Answer:** <a few lines>

   ## Findings
   - <claim>. Source: <link, or file:line, and the version or date read>

   ## Unverified
   - <claim>: found only in <where>, or contradicted by <what>; confirm by <how>
   ```

   Every finding carries its source. A claim with no primary source goes under **Unverified**,
   with what would confirm it, never among the findings.
3. Report the file's path and the answer.

When the research serves a plan, add one line to the plan that cites the file. Running anything
that costs money or changes something outside this machine is proposed to the user, never done
as part of the research.
