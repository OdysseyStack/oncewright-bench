---
name: write-for-me
description: Writes as the user, in their voice, from a profile a quiz of real situations builds; each piece comes as options with a pick. Use for a bio, posts, an article, docs or an email written as the user.
disable-model-invocation: true
---

# Write for me

A voice shows in how a person acts, more than in how they say they write. Ask what they do in
real situations, read the voice out of the answers, then write.

## 1. The profile

The profile is `voice-<slug>.md` in the persistent memory directory named in your system prompt,
`<slug>` the person or brand it speaks for, in the frontmatter that store's other files use, with
one line in its `MEMORY.md`. Later sessions then write in the voice without a new quiz. With no
memory directory, ask where to keep it: a file in the repo goes public with the repo, and the
answers are personal.

- **A finished profile exists:** read it, then offer: write now, add a round, or retake. Writing
  now goes straight to §5.
- **A profile without its readout:** resume after the last answer saved; never re-ask one.

Save each round's answers to the profile before asking the next round, so a quiz cut short loses
nothing.

## 2. Set up the quiz

One AskUserQuestion call, four questions:

1. **What it's for** (`multiSelect`): a bio or about line; social posts; a blog post or article;
   docs or a whitepaper; sales or outreach email.
2. **Whose voice:** theirs, their company's or brand's, or a character's.
3. **How long:** quick (8 questions, 2 rounds), standard (20 questions, 5 rounds, recommended),
   or deep (28 questions, 7 rounds).
4. **The mix:** situations from business, social and personal life (recommended); work only; or
   taste only (humor, rhythm, words they'd never use).

Save the answers at the top of the profile.

## 3. The quiz

Each round is one AskUserQuestion call with four questions. Before the first, say in one line:
"Pick Other and type your real answer whenever none fits; pick more than one when more than one
is true."

Each question:
- carries its area and count in the text (`Business 2/7: …`) and a short header (`2am outage`,
  `Humor`);
- puts them in a situation and asks what they do: "A prospect says a $20 tool could do this.
  Your move?", never "How formal is your writing?". What someone does shows the voice; what they
  say about their writing shows what they think it should be;
- offers four options, each a short label and a one-line description, with `multiSelect: true`
  whenever two could both be true.

Across the quiz, cover: pushback and conflict, money and pricing, a win, a failure, being wrong in
public, humor and how they take a joke, their role in a group, what drives them, how fast they
try new things, how they decide. Fit each situation to §2's answers and to what you know of
them. Ask nothing about health, family or anything else they'd mind seeing in a file.

The last two questions aim at the piece: the one impression a reader should leave with, and the
look or sound they want (a banner's mood for a bio, the rhythm of an article).

Between rounds, say only which round is next, and start nothing else: the quiz holds its thread
when the rounds come back to back.

## 4. The readout

Save to the profile, then show:

- **What the answers say:** five traits, each with the answers behind it.
- **One insight** they may not have put into words: the thread through the answers, for example
  that they are best described by how they deal with people, not by a topic.
- **How to write as them:** the rules later writing follows: words and moves to use and to avoid,
  sentence length, the kind of humor, how they open and close.

## 5. Write

Before drafting, read what they already turned down: the profile's verdicts and any earlier drafts
they point to, so no option repeats a miss.

Give three to five options of the piece, each with a one-line reason tied to a trait, and mark
your pick. When the piece replaces copy they already have, the last option is to keep it. They
pick in one reply, or take parts of several.

Save the pick and every verdict they give, in their own words, under the profile's **Verdicts**;
later writing reads those first.
