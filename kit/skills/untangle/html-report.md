# The HTML page

Built from Matt Pocock's `improve-codebase-architecture` report guide (mattpocock/skills v1.3.1,
MIT).

One self-contained HTML file beside the Markdown record, showing the same candidates. Tailwind and
Mermaid load from their CDNs; there is no other script and no interactivity beyond Mermaid's own
rendering. The page needs a network connection to look right; the Markdown record never does.

## Scaffold

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Architecture review: <repo name></title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script type="module">
      import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
      mermaid.initialize({ startOnLoad: true, theme: "neutral", securityLevel: "strict" });
    </script>
    <style>
      .seam { stroke-dasharray: 4 4; }
      .leak { stroke: #dc2626; }
      .deep { background: linear-gradient(135deg, #0f172a, #1e293b); }
    </style>
  </head>
  <body class="bg-stone-50 text-slate-900 font-sans">
    <main class="max-w-5xl mx-auto px-6 py-12 space-y-12">
      <header>repo name, date, legend</header>
      <section id="candidates" class="space-y-10">one article per candidate</section>
      <section id="top-recommendation">the top recommendation</section>
    </main>
  </body>
</html>
```

The header holds the repo name, the date and a small legend (solid box = module, dashed line =
seam, red arrow = leakage, thick dark box = deep module), and nothing else.

## A candidate

One `<article>` each, in this order:

- **Title** naming the deepening ("Collapse the order intake pipeline").
- **Badges:** the strength (`Strong` emerald, `Worth exploring` amber, `Speculative` slate) and the
  dependency category (`in-process`, `local stand-in`, `ports & adapters`, `mock`).
- **Files** in `font-mono text-sm`.
- **Before and after**, side by side, about 320px tall: the centrepiece.
- **Problem** and **Solution**, one sentence each.
- **Wins**: bullets of six words or fewer, in the words of `../shape-it/SKILL.md`
  ("locality: bugs concentrate in one module"), never "cleaner code".
- **ADR callout**, when there is one: one line in an amber box.

If a diagram needs a paragraph to be understood, redraw the diagram.

## Diagrams

Vary them; don't make every candidate look the same.

- **Mermaid graph**, for dependencies and call flow ("X calls Y calls Z, and look at the mess"),
  inside a card, with `classDef` colouring leaking edges red and the deep module dark:

  ```html
  <div class="rounded-lg border border-slate-200 bg-white p-4">
    <pre class="mermaid">
      flowchart LR
        A[OrderHandler] --> B[OrderValidator]
        B --> C[OrderRepo]
        C -.leak.-> D[PricingClient]
        classDef leak stroke:#dc2626,stroke-width:2px;
        class C,D leak
    </pre>
  </div>
  ```

  A sequence diagram suits "before: six round trips; after: one".
- **Hand-built boxes and arrows**, `<div>`s with inline SVG arrows, when the "after" should read
  as one thick-bordered deep module with its internals greyed out.
- **Cross-section**, stacked bands (`h-12 border-l-4`) for the layers a call passes through: six
  thin ones before, one thick one after.
- **Mass diagram**, two rectangles per module, interface and implementation: nearly equal before
  (shallow), a short interface over a tall implementation after (deep).
- **Call-graph collapse**: a tree of calls as nested boxes, then the same tree folded into one box
  with the now-internal calls faded inside.

## Style

Editorial, not a dashboard: generous whitespace, a serif for headings if you like, one accent
colour (emerald or indigo) plus red for leakage and amber for warnings, and module labels in
`text-xs uppercase tracking-wider` so they read as a schematic. The closing section is one larger
card: the top candidate, one sentence on why, and a link to its card.
