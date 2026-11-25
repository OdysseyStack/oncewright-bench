---
name: which-one
description: Says which kit skill or chain fits what the user wants, and why. Use when the user asks which skill or command to use, or how to do something with the kit.
---

# Which one

Built from Matt Pocock's `ask-matt` (mattpocock/skills v1.3.1, MIT); see Credits in the kit's
README for what changed.

The user knows what they want to do; name the skill that does it. Three skills answer three
questions: `/odyssey:what-next`, which work to pick up; `/odyssey:make-a-path`, where you are
with it; this one, which tool to use.

## 1. Match the intent

Read the request against the map and give one answer: the skill or chain, why it fits, and when
not to use it. When two rows fit equally, ask one question that tells them apart, with your
recommended answer first. When the answer depends on where the repo stands (a handoff waiting,
findings to triage), run
`node <this skill's base directory>/../../scripts/odyssey.mjs next` from the repo root and let
its rule decide. Each row restates its skill's own description; when they disagree, the skill's
`SKILL.md` wins, and say so.

## 2. The map

| You want to | Use | Not when |
|---|---|---|
| Set the kit up in a repo, or upgrade its rules | `/odyssey:setup` | It's set up and current: `/odyssey:setup status` says so |
| Find which piece of work to pick up | `/odyssey:what-next` | You know the work: `/odyssey:make-a-path` |
| Know where you are with this work, and the next step | `/odyssey:make-a-path` | You need the whole list of open work |
| Stress-test a plan, a design or an idea | `/odyssey:grill-me` | The plan is settled: make its next slice |
| Pin down a fuzzy or overloaded term, or record a decision as an ADR | `/odyssey:name-it` | The words are clear and the design is the question |
| Design a module's interface, or decide where a seam goes | `/odyssey:shape-it` | You don't know which module yet: `/odyssey:untangle` |
| Find where the codebase makes change hard | `/odyssey:untangle` | You already know the module |
| Answer a design question that paper can't settle | `/odyssey:try-it` | A conversation can settle it |
| Have primary sources read while you keep working | `/odyssey:look-it-up` | One fact you can check yourself |
| Build a behaviour test-first, or confirm or deny a claim | `/odyssey:prove-it` | Something broke: `/odyssey:heal-me` |
| Fix something broken: a failing test, a stack trace, a slowdown | `/odyssey:heal-me` | It isn't broken, only unbuilt |
| Review a branch or a finished slice against the standards and the plan | `/odyssey:review-me` | A pull request has CodeRabbit findings: `/odyssey:cr-triage` |
| Triage CodeRabbit's findings on a pull request or in a file | `/odyssey:cr-triage` | No review has run yet |
| Know whether the repo's gate passes, before a push | `/odyssey:local-gate` | One test is enough |
| Change the database schema | `/odyssey:db-migration` | The repo has no migration tool configured |
| Check the repo's instruction files as a whole | `/odyssey:audit` | You're writing one: `/odyssey:write-for-claude` |
| Write a skill, a rule, `CLAUDE.md` or a directive that Claude follows the same way every run | `/odyssey:write-for-claude` | |
| Write a bio, posts, an article, docs or an email in your own voice | `/odyssey:write-for-me` | Claude is the reader: `/odyssey:write-for-claude` |
| Write down a repeatable process as a directive | `/odyssey:create-directive` | It runs once |
| Walk a person through steps only they can do (a dashboard, credentials, a cutover) | `/odyssey:mage` | Claude can do the steps itself |
| Hear the last answer again in plain words | `/odyssey:today-junior` | |
| Close a session: save memory and leave the handoff, in one command | `/odyssey:wrap-up` | |
| Save what this session decided and learned, and go on | `/odyssey:remember-session` | You're ending the session: `/odyssey:wrap-up` |
| Tidy the memory index when it's too big | `/odyssey:index-it` | |
| Leave the next session its opening message, or read the one left for you | `/odyssey:handoff` | |

## 3. Chains

- **An idea to a commit:** `/odyssey:grill-me` → `/odyssey:try-it` for a question that needs
  running code → each slice made directly, test-first with `/odyssey:prove-it` →
  `/odyssey:review-me` → commit, which runs the repo's gate first. Work handed to an agent gets
  a direct brief; work that must last across sessions goes in the plan and `/odyssey:handoff write`.
- **A pull request's review rounds:** `/odyssey:cr-triage` vets the findings, the accepted fixes
  are made directly and pushed, and the next round starts with `/odyssey:cr-triage` again.
- **Upkeep:** `/odyssey:untangle` → `/odyssey:grill-me` on the candidate you pick →
  `/odyssey:shape-it`.
- **Ending a session:** `/odyssey:wrap-up`, which saves memory and then writes the handoff; the
  wrap-up mod offers it once the session passes the wrap-up mark.
