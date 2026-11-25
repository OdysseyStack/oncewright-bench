---
name: today-junior
description: Re-explains the last message in plain words, each term spelled out with the file it refers to. Use when an answer didn't land.
disable-model-invocation: true
---

# Today, junior

Built from Matt Pocock's `wait-what` (mattpocock/skills v1.3.1, MIT); see Credits in the kit's
README for what changed and why.

The last message didn't land. Say it again, from the top:

1. **Context first**: one or two sentences on what we're doing and why it matters right now.
2. **Plain words**: short sentences, one idea each, active voice, common words. ASD-STE100
   Simplified Technical English is the model.
3. **Every term once**: each kit or project term the message leaned on (a slice, a G-line,
   the handoff, the gate) gets one plain sentence and the file on disk it refers to, such as
   `directives/handoff/current.md` or the plan in `docs/plans/`. The project's own words come from `GLOSSARY.md` (through `GLOSSARY-MAP.md`
   when the repo has several).
4. **What happens next**: the next step, and what, if anything, you need from the user.

Keep it shorter than the message it replaces.
